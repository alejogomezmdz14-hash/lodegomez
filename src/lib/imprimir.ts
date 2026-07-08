// Imprime el ticket. Un respiro corto para asegurar que el ticket ya se pintó
// antes de abrir el diálogo de impresión.
export function imprimirTicket(): void {
  if (typeof window === "undefined") return;
  window.setTimeout(() => window.print(), 100);
}
