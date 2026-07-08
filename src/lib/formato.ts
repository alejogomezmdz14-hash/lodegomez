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
