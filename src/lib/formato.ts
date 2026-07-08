// Formateo de moneda argentina: $ 1.234,56
const fmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function pesos(n: number): string {
  return fmt.format(Number.isFinite(n) ? n : 0);
}

// Cantidad de kg/unidades sin ceros de más.
export function cantidadStr(n: number): string {
  return n.toLocaleString("es-AR", { maximumFractionDigits: 3 });
}

export function redondear2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Parseo de números tipeados en formato argentino: "." separa miles, "," decimal.
// "15.000" -> 15000 · "1.234,50" -> 1234.5 · "1234" -> 1234 · "" -> null.
export function parseNumeroAR(s: string): number | null {
  const limpio = s.trim();
  if (limpio === "") return null;
  const norm = limpio.replace(/\./g, "").replace(",", ".");
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}
