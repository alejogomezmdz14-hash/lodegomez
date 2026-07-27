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

// Número -> texto para un input que después lee parseNumeroAR: SIN separador de
// miles y con COMA decimal. Es el inverso exacto de parseNumeroAR.
// OJO: nunca usar String(n) para llenar esos inputs: String(1232.5) = "1232.5" y
// parseNumeroAR borra el punto (lo toma como miles) -> guardaría 12325 (x10).
export function numeroAR(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "";
  return String(Math.round(Number(n) * 100) / 100).replace(".", ",");
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
