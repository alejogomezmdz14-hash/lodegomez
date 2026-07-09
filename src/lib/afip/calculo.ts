// Convierte ítems con precio con-IVA incluido a los importes que pide AFIP.
// Id de alícuota AFIP: 21% → 5, 10,5% → 4. Exento (0) → ImpOpEx.
// Contrato: cada subtotal se normaliza a 2 decimales antes de agrupar, así el
// total se deriva de las partes y cumple ImpTotal = ImpNeto + ImpIVA + ImpOpEx
// exacto por construcción (sin reconciliación frágil).
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
  const porAlic = new Map<number, number>();
  let exento = 0;
  for (const it of items) {
    const sub = r2(it.subtotal); // normalizar a centavos (contrato)
    if (!Number.isFinite(sub)) throw new Error(`subtotal inválido: ${it.subtotal}`);
    const pct = Number(it.iva_pct);
    if (!Number.isFinite(pct)) throw new Error(`iva_pct inválido: ${it.iva_pct}`);
    if (pct === 0) {
      exento = r2(exento + sub);
      continue;
    }
    if (!IVA_ID[pct]) throw new Error(`Alícuota IVA no soportada: ${pct}`);
    porAlic.set(pct, r2((porAlic.get(pct) ?? 0) + sub));
  }

  const iva_items: IvaItem[] = [];
  let neto = 0;
  let iva = 0;
  for (const pct of [21, 10.5]) {
    const bruto = porAlic.get(pct);
    if (!bruto) continue;
    const base = r2(bruto / (1 + pct / 100));
    const imp = r2(bruto - base); // base+imp === bruto exacto (bruto ya es 2 decimales)
    iva_items.push({ Id: IVA_ID[pct], BaseImp: base, Importe: imp });
    neto = r2(neto + base);
    iva = r2(iva + imp);
  }

  // total por construcción: cumple ImpTotal = ImpNeto + ImpIVA + ImpOpEx exacto.
  const total = r2(neto + iva + exento);
  return { total, neto, iva, exento, iva_items };
}
