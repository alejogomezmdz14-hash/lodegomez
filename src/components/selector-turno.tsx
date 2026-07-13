"use client";

import { TURNOS, type Turno } from "@/lib/turno";

// Overlay que bloquea la pantalla hasta elegir el turno.
export function SelectorTurno({ onElegir }: { onElegir: (t: Turno) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/95 p-6">
      <div className="flex w-full max-w-sm flex-col gap-5 rounded-2xl border-2 p-6 text-center shadow-lg">
        <div className="flex flex-col gap-1">
          <h2 className="text-2xl font-bold">¿En qué turno estás?</h2>
          <p className="text-sm text-muted-foreground">
            Elegí tu turno para arrancar. La caja, los ingresos y los egresos
            quedan separados por turno.
          </p>
        </div>
        <div className="grid gap-3">
          {TURNOS.map((t) => (
            <button
              key={t.valor}
              type="button"
              onClick={() => onElegir(t.valor)}
              className="rounded-xl border-2 border-primary bg-primary/5 px-4 py-6 text-xl font-semibold transition-colors hover:bg-primary hover:text-primary-foreground"
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
