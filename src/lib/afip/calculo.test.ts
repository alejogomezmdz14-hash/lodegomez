import { describe, it, expect } from "vitest";
import { calcularImportes } from "./calculo";

describe("calcularImportes", () => {
  it("21%: separa neto e IVA de un precio con IVA incluido", () => {
    const r = calcularImportes([{ subtotal: 121, iva_pct: 21 }]);
    expect(r.total).toBe(121);
    expect(r.neto).toBe(100);
    expect(r.iva).toBe(21);
    expect(r.exento).toBe(0);
    expect(r.iva_items).toEqual([{ Id: 5, BaseImp: 100, Importe: 21 }]);
  });

  it("mezcla 21% y 10,5% en dos entradas de IVA", () => {
    const r = calcularImportes([
      { subtotal: 121, iva_pct: 21 },
      { subtotal: 110.5, iva_pct: 10.5 },
    ]);
    expect(r.total).toBe(231.5);
    expect(r.neto).toBe(200);
    expect(r.iva).toBe(31.5);
    expect(r.iva_items).toEqual([
      { Id: 5, BaseImp: 100, Importe: 21 },
      { Id: 4, BaseImp: 100, Importe: 10.5 },
    ]);
  });

  it("exento va a ImpOpEx y no al array de IVA", () => {
    const r = calcularImportes([
      { subtotal: 121, iva_pct: 21 },
      { subtotal: 50, iva_pct: 0 },
    ]);
    expect(r.total).toBe(171);
    expect(r.neto).toBe(100);
    expect(r.iva).toBe(21);
    expect(r.exento).toBe(50);
    expect(r.iva_items).toEqual([{ Id: 5, BaseImp: 100, Importe: 21 }]);
  });

  it("reconcilia centavos: total = neto + iva + exento exacto", () => {
    const r = calcularImportes([
      { subtotal: 100, iva_pct: 21 },
      { subtotal: 100, iva_pct: 21 },
      { subtotal: 33.33, iva_pct: 21 },
    ]);
    expect(r.total).toBe(233.33);
    expect(r.neto + r.iva + r.exento).toBeCloseTo(233.33, 2);
    expect(r.iva_items[0].BaseImp + r.iva_items[0].Importe).toBeCloseTo(233.33, 2);
  });

  it("factura all-exento cierra el invariante (total = exento)", () => {
    const r = calcularImportes([
      { subtotal: 12.34, iva_pct: 0 },
      { subtotal: 7.01, iva_pct: 0 },
    ]);
    expect(r.exento).toBe(19.35);
    expect(r.total).toBe(19.35);
    expect(r.iva_items).toEqual([]);
    expect(r.neto + r.iva + r.exento).toBe(r.total);
  });

  it("rechaza una alícuota no soportada (no la trata como exenta)", () => {
    expect(() => calcularImportes([{ subtotal: 127, iva_pct: 27 }])).toThrow(
      /no soportada/i,
    );
  });

  it("rechaza iva_pct no numérico", () => {
    expect(() =>
      calcularImportes([{ subtotal: 100, iva_pct: NaN }]),
    ).toThrow(/inválido/i);
  });
});
