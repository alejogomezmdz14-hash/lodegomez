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
  const clase = (activo: boolean, cuenta = false) =>
    cn(
      "rounded-lg border-2 px-3 py-4 text-lg font-semibold transition-colors",
      activo
        ? cuenta
          ? "border-amber-500 bg-amber-500 text-white shadow-sm"
          : "border-primary bg-primary text-primary-foreground shadow-sm"
        : cuenta
          ? "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100"
          : "border-border bg-background hover:border-primary/50 hover:bg-accent",
    );
  return (
    <div className="grid grid-cols-2 gap-2">
      {MEDIOS_COBRO.map((m) => {
        const esCuenta = m.valor === "cuenta_corriente";
        return (
          <button
            key={m.valor}
            type="button"
            onClick={() => onMedio(m.valor)}
            className={clase(!dividido && medio === m.valor, esCuenta)}
            title={esCuenta ? "No entra plata: se anota como gasto de la casa" : undefined}
          >
            {m.label}
          </button>
        );
      })}
      <button type="button" onClick={onDividir} className={clase(dividido)}>
        Dividir pago
      </button>
    </div>
  );
}
