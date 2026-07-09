// Convierte ítems con precio con-IVA incluido a los importes que pide AFIP.
// Id de alícuota AFIP: 21% → 5, 10,5% → 4. Exento (0) → ImpOpEx.
const IVA_ID: Record<number, number> = { 21: 5, 10.5: 4 };

export type IvaItem = { Id: number; BaseImp: number; Importe: number };
export type ImportesFiscales = {
  total: number;
  neto: number;
  iva: number;
  exento: number;
  iva_items: IvaItem[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcularImportes(
  items: { subtotal: number; iva_pct: number }[],
): ImportesFiscales {
  // Bruto (con IVA) agrupado por alícuota, en el orden 21 → 10,5.
  const porAlic = new Map<number, number>();
  let exento = 0;
  for (const it of items) {
    const pct = Number(it.iva_pct);
    if (!IVA_ID[pct]) {
      exento = r2(exento + it.subtotal);
      continue;
    }
    porAlic.set(pct, r2((porAlic.get(pct) ?? 0) + it.subtotal));
  }

  const iva_items: IvaItem[] = [];
  let neto = 0;
  let iva = 0;
  for (const pct of [21, 10.5]) {
    const bruto = porAlic.get(pct);
    if (!bruto) continue;
    const base = r2(bruto / (1 + pct / 100));
    const imp = r2(bruto - base);
    iva_items.push({ Id: IVA_ID[pct], BaseImp: base, Importe: imp });
    neto = r2(neto + base);
    iva = r2(iva + imp);
  }

  const total = r2(items.reduce((s, it) => s + it.subtotal, 0));
  // Reconciliación: el total debe cerrar exacto. Ajustar el último Importe/iva.
  const dif = r2(total - neto - iva - exento);
  if (dif !== 0 && iva_items.length > 0) {
    const last = iva_items[iva_items.length - 1];
    last.Importe = r2(last.Importe + dif);
    iva = r2(iva + dif);
  }

  return { total, neto, iva, exento, iva_items };
}
