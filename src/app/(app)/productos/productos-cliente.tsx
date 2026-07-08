"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { actualizarProducto } from "@/lib/actions/productos";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { pesos, parseNumeroAR } from "@/lib/formato";
import type { Producto } from "@/lib/types";

export function ProductosCliente() {
  const [term, setTerm] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    const q = term.trim();
    let cancelado = false;
    const t = setTimeout(async () => {
      if (q.length < 2) {
        if (!cancelado) {
          setResultados([]);
          setBuscando(false);
        }
        return;
      }
      setBuscando(true);
      const { data } = await supabase
        .from("productos")
        .select("*")
        .ilike("descripcion", `%${q}%`)
        .eq("activo", true)
        .order("descripcion")
        .limit(30);
      if (!cancelado) {
        setResultados((data as Producto[] | null) ?? []);
        setBuscando(false);
      }
    }, 250);
    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [term, supabase]);

  return (
    <div className="flex flex-col gap-4">
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Buscar producto por nombre…"
        className="h-11 max-w-md text-base"
      />
      {resultados.length === 0 && term.trim().length >= 2 && !buscando ? (
        <p className="text-sm text-muted-foreground">Sin resultados.</p>
      ) : null}
      <div className="flex flex-col divide-y">
        {resultados.map((p) => (
          <FilaProducto key={p.id} producto={p} />
        ))}
      </div>
    </div>
  );
}

function FilaProducto({ producto }: { producto: Producto }) {
  const inicialPrecio = String(producto.precio_venta ?? "");
  const inicialStock = String(producto.stock ?? "");
  const [precio, setPrecio] = useState(inicialPrecio);
  const [stock, setStock] = useState(inicialStock);
  const [guardadoPrecio, setGuardadoPrecio] = useState(inicialPrecio);
  const [guardadoStock, setGuardadoStock] = useState(inicialStock);
  const [pending, startTransition] = useTransition();

  const cambiado = precio !== guardadoPrecio || stock !== guardadoStock;
  const costo = Number(producto.precio_costo ?? 0);

  function guardar() {
    const cambios: { precio_venta?: number; stock?: number } = {};
    if (precio !== guardadoPrecio) {
      const p = parseNumeroAR(precio);
      if (p === null || p < 0) {
        toast.error("Precio inválido");
        return;
      }
      cambios.precio_venta = p;
    }
    if (stock !== guardadoStock) {
      const s = parseNumeroAR(stock);
      if (s === null) {
        toast.error("Stock inválido");
        return;
      }
      cambios.stock = s;
    }
    if (cambios.precio_venta === undefined && cambios.stock === undefined) return;
    startTransition(async () => {
      const res = await actualizarProducto(producto.id, cambios);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // Reflejar lo que realmente quedó en la base (evita divergencia).
      const np = res.precio_venta === null ? "" : String(res.precio_venta);
      const ns = String(res.stock);
      setPrecio(np);
      setStock(ns);
      setGuardadoPrecio(np);
      setGuardadoStock(ns);
      toast.success("Guardado");
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">
          {producto.descripcion || producto.codigo}
        </p>
        <p className="text-xs text-muted-foreground">
          {producto.codigo}
          {costo > 0 ? ` · costo ${pesos(costo)}` : ""}
        </p>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Precio
        <Input
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          inputMode="decimal"
          className="h-9 w-28 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Stock
        <Input
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          inputMode="decimal"
          className="h-9 w-24 text-sm"
        />
      </label>
      <Button onClick={guardar} disabled={pending || !cambiado}>
        {pending ? "…" : "Guardar"}
      </Button>
    </div>
  );
}
