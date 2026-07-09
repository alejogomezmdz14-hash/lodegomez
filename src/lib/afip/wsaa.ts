import "server-only";
import forge from "node-forge";
import { createAdminClient } from "@/lib/supabase/admin";

// ── Config desde env ────────────────────────────────────────────────────────
type Entorno = "homologacion" | "produccion";
const entornoAfip = (): Entorno =>
  process.env.AFIP_ENV === "produccion" ? "produccion" : "homologacion";
const cuitAfip = (): number => Number(process.env.AFIP_CUIT ?? "20409378472");
const certPem = (): string =>
  Buffer.from(process.env.AFIP_CERT_B64 ?? "", "base64").toString("utf8");
const keyPem = (): string =>
  Buffer.from(process.env.AFIP_KEY_B64 ?? "", "base64").toString("utf8");

const WSAA_URL: Record<Entorno, string> = {
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
};

class WsaaFault extends Error {}

// ── Fechas en horario Argentina (UTC-3 fijo) ────────────────────────────────
function arIso(offsetMs: number): string {
  const ar = new Date(Date.now() + offsetMs - 3 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${ar.getUTCFullYear()}-${p(ar.getUTCMonth() + 1)}-${p(ar.getUTCDate())}` +
    `T${p(ar.getUTCHours())}:${p(ar.getUTCMinutes())}:${p(ar.getUTCSeconds())}-03:00`
  );
}

// TRA: pedido de ticket. generationTime = ahora-10min, expirationTime = ahora+10min.
export function buildTRA(service = "wsfe"): string {
  const uniqueId = Math.floor(Date.now() / 1000);
  const gen = arIso(-10 * 60 * 1000);
  const exp = arIso(10 * 60 * 1000);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header><uniqueId>${uniqueId}</uniqueId>` +
    `<generationTime>${gen}</generationTime>` +
    `<expirationTime>${exp}</expirationTime></header>` +
    `<service>${service}</service></loginTicketRequest>`
  );
}

// Firma el TRA como CMS/PKCS#7 (attached, SHA-256) y lo devuelve en base64 (DER).
function firmarTRA(traXml: string): string {
  const cert = forge.pki.certificateFromPem(certPem());
  const key = forge.pki.privateKeyFromPem(keyPem());
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date().toString() },
    ],
  });
  p7.sign({ detached: false });
  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

async function loginCms(cmsBase64: string, env: Entorno) {
  const body =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/><soapenv:Body><wsaa:loginCms>` +
    `<wsaa:in0>${cmsBase64}</wsaa:in0>` +
    `</wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
  const res = await fetch(WSAA_URL[env], {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    body,
  });
  const xml = await res.text();
  const fault = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/i);
  if (fault) throw new WsaaFault(fault[1]);
  const ret = xml.match(/<loginCmsReturn>([\s\S]*?)<\/loginCmsReturn>/i);
  if (!ret) throw new Error(`WSAA: respuesta inesperada: ${xml.slice(0, 300)}`);
  const inner = unescapeXml(ret[1]);
  const token = inner.match(/<token>([\s\S]*?)<\/token>/i)?.[1] ?? "";
  const sign = inner.match(/<sign>([\s\S]*?)<\/sign>/i)?.[1] ?? "";
  const generationTime = inner.match(/<generationTime>([\s\S]*?)<\/generationTime>/i)?.[1] ?? "";
  const expirationTime = inner.match(/<expirationTime>([\s\S]*?)<\/expirationTime>/i)?.[1] ?? "";
  if (!token || !sign || !expirationTime) throw new Error("WSAA: TA incompleto");
  return { token, sign, generationTime, expirationTime };
}

// Devuelve un TA válido: usa el cacheado en Supabase si le quedan >10min; si no,
// pide uno nuevo. Si otra caja lo refrescó recién (WSAA rechaza login duplicado),
// re-lee el cache.
export async function getTA(): Promise<{ token: string; sign: string }> {
  const env = entornoAfip();
  const cuit = cuitAfip();
  const service = "wsfe";
  const SKEW = 10 * 60 * 1000;
  const admin = createAdminClient();

  const leer = async () =>
    (
      await admin
        .from("afip_ta")
        .select("token,sign,expiration_time")
        .eq("cuit", cuit)
        .eq("service", service)
        .eq("entorno", env)
        .maybeSingle()
    ).data as { token: string; sign: string; expiration_time: string } | null;

  const fila = await leer();
  if (fila && new Date(fila.expiration_time).getTime() - Date.now() > SKEW) {
    return { token: fila.token, sign: fila.sign };
  }

  try {
    const ta = await loginCms(firmarTRA(buildTRA(service)), env);
    await admin.from("afip_ta").upsert(
      {
        cuit,
        service,
        entorno: env,
        token: ta.token,
        sign: ta.sign,
        generation_time: ta.generationTime,
        expiration_time: ta.expirationTime,
      },
      { onConflict: "cuit,service,entorno" },
    );
    return { token: ta.token, sign: ta.sign };
  } catch (e) {
    // WSAA ya tiene un TA vigente (otra caja lo pidió): re-leer el cache.
    if (e instanceof WsaaFault && /ya posee|alreadyAuthenticated|CEE/i.test(e.message)) {
      const f2 = await leer();
      if (f2) return { token: f2.token, sign: f2.sign };
    }
    throw e;
  }
}
