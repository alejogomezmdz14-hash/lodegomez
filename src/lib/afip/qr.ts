import QRCode from "qrcode";

// Datos del QR según RG AFIP 4892. Ver https://www.afip.gob.ar/fe/qr/
export type DatosQr = {
  fecha: string; // yyyy-mm-dd
  cuit: number; // emisor
  ptoVta: number;
  tipoCmp: number; // 1 A, 6 B
  nroCmp: number;
  importe: number;
  docTipoRec?: number; // omitir para consumidor final (DocTipo 99)
  docNroRec?: number;
  cae: string;
};

export function construirQrPayload(d: DatosQr): string {
  const obj: Record<string, unknown> = {
    ver: 1,
    fecha: d.fecha,
    cuit: d.cuit,
    ptoVta: d.ptoVta,
    tipoCmp: d.tipoCmp,
    nroCmp: d.nroCmp,
    importe: d.importe,
    moneda: "PES",
    ctz: 1,
  };
  // tipoDocRec/nroDocRec son "de corresponder": solo si el receptor está
  // identificado (Factura A). Para consumidor final (99/0) se omiten.
  if (d.docTipoRec && d.docTipoRec !== 99 && d.docNroRec && d.docNroRec > 0) {
    obj.tipoDocRec = d.docTipoRec;
    obj.nroDocRec = d.docNroRec;
  }
  obj.tipoCodAut = "E";
  obj.codAut = Number(d.cae);
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

export function qrUrl(payloadBase64: string): string {
  return `https://www.afip.gob.ar/fe/qr/?p=${payloadBase64}`;
}

// SVG del QR (vector, blanco y negro nítido para la térmica).
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}
