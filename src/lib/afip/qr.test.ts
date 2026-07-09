import { describe, it, expect } from "vitest";
import { construirQrPayload, qrUrl } from "./qr";

function decode(p: string) {
  return JSON.parse(Buffer.from(p, "base64").toString("utf8"));
}

describe("QR de AFIP", () => {
  it("consumidor final: omite tipoDocRec/nroDocRec (son 'de corresponder')", () => {
    const obj = decode(
      construirQrPayload({
        fecha: "2026-07-08",
        cuit: 27288869990,
        ptoVta: 7,
        tipoCmp: 6,
        nroCmp: 21608,
        importe: 20100,
        docTipoRec: 99,
        docNroRec: 0,
        cae: "86273030548980",
      }),
    );
    expect(obj).toMatchObject({
      ver: 1,
      fecha: "2026-07-08",
      cuit: 27288869990,
      ptoVta: 7,
      tipoCmp: 6,
      nroCmp: 21608,
      importe: 20100,
      moneda: "PES",
      ctz: 1,
      tipoCodAut: "E",
      codAut: 86273030548980,
    });
    expect(obj.tipoDocRec).toBeUndefined();
    expect(obj.nroDocRec).toBeUndefined();
  });

  it("receptor identificado (Factura A): incluye tipoDocRec/nroDocRec", () => {
    const obj = decode(
      construirQrPayload({
        fecha: "2026-07-08",
        cuit: 27288869990,
        ptoVta: 7,
        tipoCmp: 1,
        nroCmp: 55,
        importe: 12100,
        docTipoRec: 80,
        docNroRec: 30111222223,
        cae: "12345678901234",
      }),
    );
    expect(obj.tipoDocRec).toBe(80);
    expect(obj.nroDocRec).toBe(30111222223);
  });

  it("qrUrl usa el dominio oficial de AFIP", () => {
    expect(qrUrl("ABC")).toBe("https://www.afip.gob.ar/fe/qr/?p=ABC");
  });
});
