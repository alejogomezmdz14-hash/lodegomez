"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { pesos, redondear2, cantidadStr } from "@/lib/formato";
import { listarEmpleados } from "@/lib/actions/ventas";
import {
  GASTOS,
  type CartItem,
  type EmpleadoSimple,
  type TipoGasto,
} from "@/lib/types";

// Registra el carrito como un gasto (casa / local / empleado) en vez de un cobro.
// Casa y local van AL COSTO; empleados al precio de venta (lo pagan).
export function DialogoGasto({
  tipo,
  items,
  onCerrar,
  onConfirmar,
  pendiente,
}: {
  tipo: TipoGasto | null;
  items: CartItem[];
  onCerrar: () => void;
  onConfirmar: (personaId: string | null, total: number) => void;
  pendiente: boolean;
}) {
  const cfg = GASTOS.find((g) => g.valor === tipo);
  const [empleados, setEmpleados] = useState<EmpleadoSimple[]>([]);
  const [persona, setPersona] = useState("");

  // El padre remonta este componente con `key` al cambiar de tipo, así que el
  // estado arranca limpio y acá solo se cargan los nombres.
  useEffect(() => {
    if (tipo && cfg?.pidePersona) listarEmpleados().then(setEmpleados);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipo]);

  if (!tipo || !cfg) return null;

  // Al costo: si un producto no tiene costo cargado se usa su precio de venta
  // (para no trabar la operación) y se avisa cuáles fueron.
  const sinCosto = cfg.alCosto
    ? items.filter((it) => !(Number(it.costo_unit) > 0))
    : [];
  const valor = (it: CartItem) =>
    cfg.alCosto && Number(it.costo_unit) > 0
      ? Number(it.costo_unit)
      : it.precio_unit;
  const total = redondear2(
    items.reduce((s, it) => s + valor(it) * it.cantidad, 0),
  );

  function confirmar() {
    if (cfg!.pidePersona && !persona) {
      toast.error("Elegí quién fue");
      return;
    }
    onConfirmar(persona || null, total);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border-2 border-amber-300 bg-background p-5 shadow-lg">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold">{cfg.label}</h2>
          <p className="text-sm text-muted-foreground">{cfg.ayuda}</p>
        </div>

        {cfg.pidePersona ? (
          <label className="flex flex-col gap-1 text-sm font-medium">
            ¿Quién fue?
            <select
              autoFocus
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              className="h-11 rounded-lg border-2 border-border bg-background px-2 text-base"
            >
              <option value="">Elegí…</option>
              {empleados.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="max-h-48 overflow-y-auto rounded-lg border p-2 text-sm">
          {items.map((it, i) => (
            <div key={i} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                {it.descripcion}
                <span className="text-muted-foreground">
                  {" · "}
                  {it.es_pesable
                    ? `${cantidadStr(it.cantidad)} kg`
                    : `${it.cantidad} u`}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">
                {pesos(redondear2(valor(it) * it.cantidad))}
              </span>
            </div>
          ))}
        </div>

        {sinCosto.length > 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {sinCosto.length} producto(s) sin precio de costo cargado: se anotan
            al precio de venta. Cargales el costo en Productos para que el gasto
            sea exacto.
          </p>
        ) : null}

        <div className="flex items-baseline justify-between border-t pt-2">
          <span className="text-sm text-muted-foreground">
            {cfg.alCosto ? "Total al costo" : "Total"}
          </span>
          <span className="text-2xl font-bold tabular-nums">{pesos(total)}</span>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={confirmar}
            disabled={pendiente}
            size="lg"
            className="flex-1 bg-amber-500 text-white hover:bg-amber-600"
          >
            {pendiente ? "Guardando…" : "Confirmar"}
          </Button>
          <Button variant="outline" size="lg" onClick={onCerrar} disabled={pendiente}>
            Cancelar
          </Button>
        </div>
      </div>
    </div>
  );
}
