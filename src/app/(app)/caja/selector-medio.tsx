"use client";

import { MEDIOS_PAGO, type MedioPago } from "@/lib/types";
import { cn } from "@/lib/utils";

export function SelectorMedio({
  value,
  onChange,
}: {
  value: MedioPago | null;
  onChange: (m: MedioPago) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {MEDIOS_PAGO.map((m) => (
        <button
          key={m.valor}
          type="button"
          onClick={() => onChange(m.valor)}
          className={cn(
            "rounded-lg border-2 px-3 py-4 text-lg font-semibold transition-colors",
            value === m.valor
              ? "border-primary bg-primary text-primary-foreground shadow-sm"
              : "border-border bg-background hover:border-primary/50 hover:bg-accent",
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
