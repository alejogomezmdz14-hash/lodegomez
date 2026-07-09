"use client";

import { type FormEvent, useState } from "react";
import { toast } from "sonner";
import { crearProducto } from "@/lib/actions/productos";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { parseNumeroAR } from "@/lib/formato";
import type { Producto } from "@/lib/types";

// El padre lo remonta con `key` según el código inicial, así arranca limpio.
export function NuevoProductoDialog({
  abierto,
  codigoInicial = "",
  onCerrar,
  onCreado,
}: {
  abierto: boolean;
  codigoInicial?: string;
  onCerrar: () => void;
  onCreado: (p: Producto) => void;
}) {
  const [codigo, setCodigo] = useState(codigoInicial);
  const [descripcion, setDescripcion] = useState("");
  const [rubro, setRubro] = useState("");
  const [precio, setPrecio] = useState("");
  const [costo, setCosto] = useState("");
  const [pesable, setPesable] = useState(false);
  const [guardando, setGuardando] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    const pv = parseNumeroAR(precio);
    if (pv === null || pv <= 0) {
      toast.error("Poné un precio válido");
      return;
    }
    const pc = costo.trim() === "" ? undefined : (parseNumeroAR(costo) ?? undefined);
    setGuardando(true);
    crearProducto({
      codigo,
      descripcion,
      rubro,
      precio_venta: pv,
      precio_costo: pc,
      es_pesable: pesable,
    }).then((res) => {
      setGuardando(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Producto creado");
      onCreado(res.producto);
    });
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
          <DialogTitle>Nuevo producto</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            Código
            <Input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              autoFocus={codigoInicial === ""}
              placeholder="Escaneá o tipeá el código"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Descripción
            <Input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              autoFocus={codigoInicial !== ""}
              placeholder="Nombre del producto"
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {pesable ? "Precio por kg" : "Precio de venta"}
              <Input
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Costo (opcional)
              <Input
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
                inputMode="decimal"
                placeholder="0"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Rubro (opcional)
            <Input
              value={rubro}
              onChange={(e) => setRubro(e.target.value)}
              placeholder="Ej: BEBIDAS"
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={pesable}
              onChange={(e) => setPesable(e.target.checked)}
              className="size-4 accent-primary"
            />
            Se vende por kg (pesable)
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCerrar}>
              Cancelar
            </Button>
            <Button type="submit" disabled={guardando}>
              {guardando ? "Creando…" : "Crear"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
