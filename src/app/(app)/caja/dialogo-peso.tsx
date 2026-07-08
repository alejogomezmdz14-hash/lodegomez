"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pesos } from "@/lib/formato";
import type { Producto } from "@/lib/types";

// Ingreso de peso manual (la balanza no está conectada) para productos pesables:
// fiambre, verdura, etc. cantidad = kg. El padre lo remonta con `key` por
// producto, así el campo arranca vacío en cada apertura (sin effect de reset).
export function DialogoPeso({
  producto,
  onConfirmar,
  onCerrar,
}: {
  producto: Producto | null;
  onConfirmar: (kg: number) => void;
  onCerrar: () => void;
}) {
  const [valor, setValor] = useState("");

  const abierto = producto !== null;
  const kg = Number(valor.replace(",", "."));
  const valido = kg > 0 && Number.isFinite(kg);
  const precioKg = Number(producto?.precio_por_kg ?? 0);

  function confirmar() {
    if (!valido) return;
    onConfirmar(kg);
  }

  return (
    <Dialog
      open={abierto}
      onOpenChange={(o) => {
        if (!o) onCerrar();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{producto?.descripcion ?? "Peso"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Precio por kg: {pesos(precioKg)}
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Peso (kg)</span>
            <Input
              autoFocus
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  confirmar();
                }
              }}
              placeholder="0.000"
              className="h-12 text-lg"
            />
          </label>
          {valido ? (
            <p className="text-sm">
              Subtotal: <strong>{pesos(kg * precioKg)}</strong>
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={!valido}>
            Agregar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
