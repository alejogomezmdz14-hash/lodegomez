"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Download, Trash2, EyeOff, RotateCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useScanner } from "@/lib/hooks/use-scanner";
import {
  actualizarProducto,
  setProductoActivo,
  borrarProducto,
} from "@/lib/actions/productos";
import { NuevoProductoDialog } from "@/components/nuevo-producto-dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { pesos, parseNumeroAR } from "@/lib/formato";
import type { Producto } from "@/lib/types";

export function ProductosCliente() {
  const [term, setTerm] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [supabase] = useState(() => createClient());
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [verDesactivados, setVerDesactivados] = useState(false);
  const buscarRef = useRef<HTMLInputElement>(null);

  // Scanner global: si escaneás con la pistola (aunque el foco no esté en la
  // caja de búsqueda), el código va al buscador y encuentra el producto.
  useScanner(
    (code) => setTerm(code),
    { enabled: !nuevoAbierto, ignore: () => buscarRef.current },
  );

  useEffect(() => {
    const q = term.trim();
    let cancelado = false;
    const t = setTimeout(async () => {
      // Sanitizar para no romper el filtro .or (coma/paréntesis/% son estructurales).
      const safe = q.replace(/[%,()]/g, " ").trim();
      if (safe.length < 2) {
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
        .or(`descripcion.ilike.%${safe}%,codigo.ilike.%${safe}%`)
        .eq("activo", !verDesactivados)
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
  }, [term, supabase, verDesactivados]);

  function quitar(id: string) {
    setResultados((prev) => prev.filter((x) => x.id !== id));
  }

  async function exportar() {
    setExportando(true);
    const filas: Producto[] = [];
    const paso = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("productos")
        .select("codigo,descripcion,rubro,precio_costo,precio_venta,stock")
        .order("descripcion")
        .range(from, from + paso - 1);
      if (error) {
        toast.error("Error al exportar");
        setExportando(false);
        return;
      }
      const d = (data as Producto[] | null) ?? [];
      filas.push(...d);
      if (d.length < paso) break;
      from += paso;
    }
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lineas = ["codigo,descripcion,rubro,precio_costo,precio_venta,stock"];
    for (const p of filas) {
      lineas.push(
        [p.codigo, p.descripcion, p.rubro, p.precio_costo, p.precio_venta, p.stock]
          .map(esc)
          .join(","),
      );
    }
    const csv = "﻿" + lineas.join("\n"); // BOM para que Excel abra bien
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "productos-lodegomez.csv";
    a.click();
    URL.revokeObjectURL(url);
    setExportando(false);
    toast.success(`${filas.length} productos exportados`);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={buscarRef}
          autoFocus
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder={
            verDesactivados
              ? "Buscar desactivados por nombre o código…"
              : "Buscar por nombre o código — o escaneá"
          }
          className="h-11 max-w-md text-base"
        />
        <Button onClick={() => setNuevoAbierto(true)}>
          <Plus className="h-4 w-4" /> Nuevo producto
        </Button>
        <Button variant="outline" onClick={exportar} disabled={exportando}>
          <Download className="h-4 w-4" /> {exportando ? "Exportando…" : "Exportar"}
        </Button>
        <Button
          variant={verDesactivados ? "default" : "outline"}
          onClick={() => setVerDesactivados((v) => !v)}
          title="Ver los productos desactivados para recuperarlos o borrarlos"
        >
          <EyeOff className="h-4 w-4" />{" "}
          {verDesactivados ? "Viendo desactivados" : "Ver desactivados"}
        </Button>
      </div>

      {resultados.length === 0 && term.trim().length >= 2 && !buscando ? (
        <p className="text-sm text-muted-foreground">
          {verDesactivados
            ? "No hay productos desactivados con ese nombre."
            : "Sin resultados. Podés darlo de alta con “Nuevo producto”."}
        </p>
      ) : null}

      <div className="flex flex-col divide-y">
        {resultados.map((p) => (
          <FilaProducto key={p.id} producto={p} onQuitar={quitar} />
        ))}
      </div>

      <NuevoProductoDialog
        key={nuevoAbierto ? "abierto" : "cerrado"}
        abierto={nuevoAbierto}
        onCerrar={() => setNuevoAbierto(false)}
        onCreado={(p) => {
          setResultados((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
          setNuevoAbierto(false);
        }}
      />
    </div>
  );
}

function FilaProducto({
  producto,
  onQuitar,
}: {
  producto: Producto;
  onQuitar: (id: string) => void;
}) {
  const iP = String(producto.precio_venta ?? "");
  const iC = String(producto.precio_costo ?? "");
  const iS = String(producto.stock ?? "");
  const [precio, setPrecio] = useState(iP);
  const [costo, setCosto] = useState(iC);
  const [stock, setStock] = useState(iS);
  const [gP, setGP] = useState(iP);
  const [gC, setGC] = useState(iC);
  const [gS, setGS] = useState(iS);
  const [pending, startTransition] = useTransition();
  const [accion, startAccion] = useTransition();
  const [confirmandoBorrar, setConfirmandoBorrar] = useState(false);

  const cambiado = precio !== gP || costo !== gC || stock !== gS;
  const activo = producto.activo;

  function guardar() {
    const cambios: { precio_venta?: number; precio_costo?: number; stock?: number } = {};
    if (precio !== gP) {
      const v = parseNumeroAR(precio);
      if (v === null || v < 0) {
        toast.error("Precio inválido");
        return;
      }
      cambios.precio_venta = v;
    }
    if (costo !== gC) {
      const v = costo.trim() === "" ? 0 : parseNumeroAR(costo);
      if (v === null || v < 0) {
        toast.error("Costo inválido");
        return;
      }
      cambios.precio_costo = v;
    }
    if (stock !== gS) {
      const v = parseNumeroAR(stock);
      if (v === null) {
        toast.error("Stock inválido");
        return;
      }
      cambios.stock = v;
    }
    if (Object.keys(cambios).length === 0) return;
    startTransition(async () => {
      const res = await actualizarProducto(producto.id, cambios);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const np = res.precio_venta === null ? "" : String(res.precio_venta);
      const nc = res.precio_costo === null ? "" : String(res.precio_costo);
      const ns = String(res.stock);
      setPrecio(np);
      setCosto(nc);
      setStock(ns);
      setGP(np);
      setGC(nc);
      setGS(ns);
      toast.success("Guardado");
    });
  }

  function desactivar() {
    startAccion(async () => {
      const res = await setProductoActivo(producto.id, false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onQuitar(producto.id);
      toast.success("Desactivado. Está en “Ver desactivados” para recuperarlo.");
    });
  }

  function reactivar() {
    startAccion(async () => {
      const res = await setProductoActivo(producto.id, true);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onQuitar(producto.id);
      toast.success("Reactivado. Ya se puede vender.");
    });
  }

  function borrar() {
    startAccion(async () => {
      const res = await borrarProducto(producto.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onQuitar(producto.id);
      toast.success("Borrado definitivamente.");
    });
  }

  const pv = parseNumeroAR(precio) ?? 0;
  const pc = parseNumeroAR(costo) ?? 0;
  const ganancia = pc > 0 ? pv - pc : null;

  return (
    <div
      className={`flex flex-wrap items-end gap-3 py-3 ${activo ? "" : "opacity-70"}`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate font-medium">
          {producto.descripcion || producto.codigo}
          {!activo ? (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
              Desactivado
            </span>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {producto.codigo}
          {ganancia !== null ? ` · ganás ${pesos(ganancia)}` : ""}
        </p>
      </div>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Costo
        <Input
          value={costo}
          onChange={(e) => setCosto(e.target.value)}
          inputMode="decimal"
          className="h-9 w-24 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Precio
        <Input
          value={precio}
          onChange={(e) => setPrecio(e.target.value)}
          inputMode="decimal"
          className="h-9 w-24 text-sm"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Stock
        <Input
          value={stock}
          onChange={(e) => setStock(e.target.value)}
          inputMode="decimal"
          className="h-9 w-20 text-sm"
        />
      </label>
      <Button onClick={guardar} disabled={pending || !cambiado}>
        {pending ? "…" : "Guardar"}
      </Button>

      {activo ? (
        <Button
          variant="outline"
          onClick={desactivar}
          disabled={accion}
          title="Desactivar (recuperable): se esconde y no se puede vender"
        >
          <EyeOff className="h-4 w-4" /> Desactivar
        </Button>
      ) : (
        <Button
          variant="outline"
          onClick={reactivar}
          disabled={accion}
          title="Volver a activar el producto"
        >
          <RotateCcw className="h-4 w-4" /> Reactivar
        </Button>
      )}

      {confirmandoBorrar ? (
        <div className="flex items-center gap-1">
          <Button
            onClick={borrar}
            disabled={accion}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {accion ? "…" : "Sí, borrar"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirmandoBorrar(false)}
            disabled={accion}
          >
            Cancelar
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          onClick={() => setConfirmandoBorrar(true)}
          disabled={accion}
          className="text-red-600 hover:bg-red-50 hover:text-red-700"
          title="Borrar definitivamente (no se puede deshacer)"
        >
          <Trash2 className="h-4 w-4" /> Borrar
        </Button>
      )}
    </div>
  );
}
