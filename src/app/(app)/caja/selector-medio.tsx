"use client";

import { MEDIOS_COBRO, type MedioPago } from "@/lib/types";
import { cn } from "@/lib/utils";

// 3 medios (sin QR) + "Dividir pago" como cuarto botón. Se maneja con mouse,
// touch o teclado (flechas eligen; el seleccionado queda resaltado).
export function SelectorMedio({
  medio,
  dividido,
  onMedio,
  onDividir,
}: {
  medio: MedioPago | null;
  dividido: boolean;
  onMedio: (m: MedioPago) => void;
  onDividir: () => void;
}) {
  const clase = (activo: boolean) =>
    cn(
      "rounded-lg border-2 px-3 py-4 text-lg font-semibold transition-colors",
      activo
        ? "border-primary bg-primary text-primary-foreground shadow-sm"
        : "border-border bg-background hover:border-primary/50 hover:bg-accent",
    );
  return (
    <div className="grid grid-cols-2 gap-2">
      {MEDIOS_COBRO.map((m) => (
        <button
          key={m.valor}
          type="button"
          onClick={() => onMedio(m.valor)}
          className={clase(!dividido && medio === m.valor)}
        >
          {m.label}
        </button>
      ))}
      <button type="button" onClick={onDividir} className={clase(dividido)}>
        Dividir pago
      </button>
    </div>
  );
}
