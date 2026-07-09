import "server-only";
import { getTA } from "./wsaa";
import { afipPost } from "./http";

type Entorno = "homologacion" | "produccion";
const entornoAfip = (): Entorno =>
  process.env.AFIP_ENV === "produccion" ? "produccion" : "homologacion";
const cuitAfip = (): number => Number(process.env.AFIP_CUIT ?? "20409378472");

const WSFE_URL: Record<Entorno, string> = {
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
};

// Llama un método WSFEv1 con el <Auth> (Token/Sign de getTA + Cuit). Devuelve el XML crudo.
async function callWsfe(metodo: string, innerXml: string): Promise<string> {
  const { token, sign } = await getTA();
  const auth =
    `<ar:Auth><ar:Token>${token}</ar:Token><ar:Sign>${sign}</ar:Sign>` +
    `<ar:Cuit>${cuitAfip()}</ar:Cuit></ar:Auth>`;
  const body =
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soap:Body>` +
    `<ar:${metodo}>${auth}${innerXml}</ar:${metodo}>` +
    `</soap:Body></soap:Envelope>`;
  return afipPost(
    WSFE_URL[entornoAfip()],
    `http://ar.gov.afip.dif.FEV1/${metodo}`,
    body,
    `WSFE ${metodo}`,
  );
}

// Extrae el contenido de un tag (tolerante a prefijo de namespace).
const pick = (xml: string, tag: string): string | undefined =>
  xml.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)</(?:\\w+:)?${tag}>`, "i"))?.[1];

// Junta los <Err><Code/><Msg/></Err> en un texto.
function erroresDe(xml: string): string {
  return [...xml.matchAll(/<(?:\w+:)?Err>([\s\S]*?)<\/(?:\w+:)?Err>/gi)]
    .map((m) => `(${pick(m[1], "Code") ?? ""}) ${pick(m[1], "Msg") ?? ""}`)
    .join("; ");
}

const yyyymmddAIso = (v: string | number): string => {
  const s = String(v);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
};

// FECompUltimoAutorizado → último número autorizado (0 si nunca emitió).
export async function wsfeUltimoAutorizado(ptoVta: number, cbteTipo: number): Promise<number> {
  const xml = await callWsfe(
    "FECompUltimoAutorizado",
    `<ar:PtoVta>${ptoVta}</ar:PtoVta><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>`,
  );
  const nro = pick(xml, "CbteNro");
  if (nro == null) {
    throw new Error(`WSFE FECompUltimoAutorizado: ${erroresDe(xml) || xml.slice(0, 300)}`);
  }
  return Number(nro);
}

// FECAESolicitar → { CAE, CAEFchVto('yyyy-mm-dd') }. v es el objeto de armarVoucher().
// ORDEN DE CAMPOS = XSD de AFIP (NO cambiar el orden): Concepto, DocTipo, DocNro,
// CbteDesde, CbteHasta, CbteFch, ImpTotal, ImpTotConc, ImpNeto, ImpOpEx, ImpTrib,
// ImpIVA, MonId, MonCotiz, CondicionIVAReceptorId, Iva.
export async function wsfeSolicitarCAE(
  v: {
    PtoVta: number; CbteTipo: number; Concepto: number; DocTipo: number; DocNro: number;
    CbteDesde: number; CbteHasta: number; CbteFch: number | string;
    ImpTotal: number; ImpTotConc: number; ImpNeto: number; ImpOpEx: number;
    ImpIVA: number; ImpTrib: number; MonId: string; MonCotiz: number;
    CondicionIVAReceptorId: number; Iva?: { Id: number; BaseImp: number; Importe: number }[];
  },
): Promise<{ CAE: string; CAEFchVto: string }> {
  const ivaXml =
    Array.isArray(v.Iva) && v.Iva.length
      ? `<ar:Iva>${v.Iva
          .map(
            (a) =>
              `<ar:AlicIva><ar:Id>${a.Id}</ar:Id><ar:BaseImp>${a.BaseImp}</ar:BaseImp>` +
              `<ar:Importe>${a.Importe}</ar:Importe></ar:AlicIva>`,
          )
          .join("")}</ar:Iva>`
      : "";
  const det =
    `<ar:Concepto>${v.Concepto}</ar:Concepto>` +
    `<ar:DocTipo>${v.DocTipo}</ar:DocTipo><ar:DocNro>${v.DocNro}</ar:DocNro>` +
    `<ar:CbteDesde>${v.CbteDesde}</ar:CbteDesde><ar:CbteHasta>${v.CbteHasta}</ar:CbteHasta>` +
    `<ar:CbteFch>${v.CbteFch}</ar:CbteFch>` +
    `<ar:ImpTotal>${v.ImpTotal}</ar:ImpTotal><ar:ImpTotConc>${v.ImpTotConc}</ar:ImpTotConc>` +
    `<ar:ImpNeto>${v.ImpNeto}</ar:ImpNeto><ar:ImpOpEx>${v.ImpOpEx}</ar:ImpOpEx>` +
    `<ar:ImpTrib>${v.ImpTrib}</ar:ImpTrib><ar:ImpIVA>${v.ImpIVA}</ar:ImpIVA>` +
    `<ar:MonId>${v.MonId}</ar:MonId><ar:MonCotiz>${v.MonCotiz}</ar:MonCotiz>` +
    `<ar:CondicionIVAReceptorId>${v.CondicionIVAReceptorId}</ar:CondicionIVAReceptorId>` +
    ivaXml;
  const inner =
    `<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg>` +
    `<ar:PtoVta>${v.PtoVta}</ar:PtoVta><ar:CbteTipo>${v.CbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq><ar:FECAEDetRequest>${det}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`;

  const xml = await callWsfe("FECAESolicitar", inner);
  const resultado = pick(xml, "Resultado"); // primer Resultado = FeCabResp (global)
  const cae = pick(xml, "CAE");
  if (resultado !== "A" || !cae) {
    const obs = [...xml.matchAll(/<(?:\w+:)?Obs>([\s\S]*?)<\/(?:\w+:)?Obs>/gi)]
      .map((m) => `(${pick(m[1], "Code") ?? ""}) ${pick(m[1], "Msg") ?? ""}`)
      .join("; ");
    const errs = erroresDe(xml);
    throw new Error(
      `WSFE FECAESolicitar rechazado: ${[obs, errs].filter(Boolean).join(" | ") || xml.slice(0, 400)}`,
    );
  }
  return { CAE: cae, CAEFchVto: yyyymmddAIso(pick(xml, "CAEFchVto") ?? "") };
}

// FECompConsultar → datos crudos (yyyymmdd) o null si no existe (Errors 602).
export async function wsfeConsultar(
  nro: number, ptoVta: number, cbteTipo: number,
): Promise<{ CodAutorizacion: string; FchVto: string; CbteFch: string } | null> {
  const inner =
    `<ar:FeCompConsReq><ar:CbteTipo>${cbteTipo}</ar:CbteTipo>` +
    `<ar:CbteNro>${nro}</ar:CbteNro><ar:PtoVta>${ptoVta}</ar:PtoVta></ar:FeCompConsReq>`;
  const xml = await callWsfe("FECompConsultar", inner);
  const cod = pick(xml, "CodAutorizacion");
  if (cod) {
    return {
      CodAutorizacion: cod,
      FchVto: pick(xml, "FchVto") ?? "",
      CbteFch: pick(xml, "CbteFch") ?? "",
    };
  }
  const errs = erroresDe(xml);
  if (!errs || /\b602\b/.test(errs)) return null; // 602 = no existen datos → nunca autorizado
  throw new Error(`WSFE FECompConsultar: ${errs}`);
}
