"use client";

import { Minus, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pesos, cantidadStr } from "@/lib/formato";
import type { CartItem } from "@/lib/types";

export function Carrito({
  items,
  onInc,
  onDec,
  onQuitar,
}: {
  items: CartItem[];
  onInc: (i: number) => void;
  onDec: (i: number) => void;
  onQuitar: (i: number) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-center text-muted-foreground">
        Escaneá o buscá un producto para empezar.
      </div>
    );
  }

  return (
    <ul className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto">
      {items.map((it, i) => (
        <li key={i} className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{it.descripcion}</p>
            <p className="text-sm text-muted-foreground tabular-nums">
              {it.es_pesable
                ? `${cantidadStr(it.cantidad)} kg × ${pesos(it.precio_unit)}`
                : `${it.cantidad} × ${pesos(it.precio_unit)}`}
            </p>
          </div>

          {!it.es_pesable ? (
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                onClick={() => onDec(i)}
                aria-label="Restar uno"
              >
                <Minus />
              </Button>
              <span className="w-8 text-center tabular-nums">{it.cantidad}</span>
              <Button
                size="icon"
                variant="outline"
                onClick={() => onInc(i)}
                aria-label="Sumar uno"
              >
                <Plus />
              </Button>
            </div>
          ) : null}

          <span className="w-28 text-right font-semibold tabular-nums">
            {pesos(it.subtotal)}
          </span>

          <Button
            size="icon"
            variant="ghost"
            onClick={() => onQuitar(i)}
            aria-label="Quitar"
          >
            <Trash2 className="text-destructive" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
