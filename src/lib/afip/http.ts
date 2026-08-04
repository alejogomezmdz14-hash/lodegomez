import "server-only";
import { fetch as undiciFetch, Agent } from "undici";

// AFIP negocia TLS con parámetros Diffie-Hellman de 1024 bits, que el OpenSSL de
// Node (Linux/Vercel) rechaza por defecto con ERR_SSL_DH_KEY_TOO_SMALL. Bajamos
// el "security level" SOLO para las conexiones a AFIP, con un agente dedicado —
// no afecta la seguridad TLS del resto de la app (Supabase, etc.).
const afipAgent = new Agent({ connect: { ciphers: "DEFAULT@SECLEVEL=0" } });

// POST SOAP a AFIP; devuelve el XML de respuesta como texto. Si la conexión
// falla, lanza con la causa real (código de undici) para diagnosticar.
export async function afipPost(
  url: string,
  soapAction: string,
  body: string,
  etiqueta: string,
): Promise<string> {
  try {
    const res = await undiciFetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: soapAction },
      body,
      dispatcher: afipAgent,
    });
    const texto = await res.text();
    // AFIP caído devuelve una página HTML ("Service Unavailable"), no XML. Sin
    // este chequeo, ese HTML se parseaba como respuesta y terminaba mostrándose
    // crudo en pantalla al cajero.
    if (!res.ok) {
      throw new Error(`AFIP_CAIDO:${etiqueta}:HTTP ${res.status}`);
    }
    if (/^\s*<(!doctype|html)\b/i.test(texto)) {
      throw new Error(`AFIP_CAIDO:${etiqueta}:respuesta HTML`);
    }
    return texto;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("AFIP_CAIDO:")) throw e;
    const c = (e as { cause?: { code?: string; message?: string } }).cause;
    throw new Error(
      `conexion ${etiqueta} fallo: ${c?.code ?? c?.message ?? (e as Error).message}`,
    );
  }
}
