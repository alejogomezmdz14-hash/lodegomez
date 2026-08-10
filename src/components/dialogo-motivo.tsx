"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Pide el motivo de una anulación. El motivo es obligatorio: queda en el aviso
// a los dueños, así que "Cancelada en el momento" para todo no sirve de nada.
const MIN = 3;

export function DialogoMotivo({
  abierto,
  titulo,
  detalle,
  pendiente,
  onCerrar,
  onConfirmar,
}: {
  abierto: boolean;
  titulo: string;
  detalle?: string;
  pendiente?: boolean;
  onCerrar: () => void;
  onConfirmar: (motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  if (!abierto) return null;
  const corto = motivo.trim().length < MIN;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-4">
      <div className="flex w-full max-w-md flex-col gap-3 rounded-2xl border-2 border-destructive/40 bg-background p-5 shadow-lg">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold">{titulo}</h2>
          {detalle ? (
            <p className="text-sm text-muted-foreground">{detalle}</p>
          ) : null}
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium">
          ¿Por qué se anula? (obligatorio)
          <Input
            autoFocus
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !corto && !pendiente) {
                e.preventDefault();
                onConfirmar(motivo.trim());
              }
            }}
            placeholder="Ej: se arrepintió, cobré de más, producto equivocado…"
            className="h-11 text-base"
          />
        </label>

        <div className="flex gap-2">
          <Button
            onClick={() => onConfirmar(motivo.trim())}
            disabled={corto || pendiente}
            size="lg"
            className="flex-1 bg-red-600 text-white hover:bg-red-700"
          >
            {pendiente ? "Anulando…" : "Anular"}
          </Button>
          <Button variant="outline" size="lg" onClick={onCerrar} disabled={pendiente}>
            Volver
          </Button>
        </div>
      </div>
    </div>
  );
}
