"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Check, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cantidadStr } from "@/lib/formato";
import type { FaltanteManual, RubroConfig } from "@/lib/types";

type ProductoRubro = {
  id: string;
  codigo: string;
  descripcion: string | null;
  stock: number;
};

export function ReposicionCliente() {
  const [supabase] = useState(() => createClient());
  const [rubros, setRubros] = useState<RubroConfig[]>([]);
  const [rubroSel, setRubroSel] = useState("");
  const [prods, setProds] = useState<ProductoRubro[]>([]);
  const [cargandoProds, setCargandoProds] = useState(false);
  const [pedido, setPedido] = useState<FaltanteManual[]>([]);
  const [nuevo, setNuevo] = useState("");
  const [pending, startTransition] = useTransition();

  // El pedido persiste en faltantes_manuales. Un producto está "cargado" si hay
  // un renglón del pedido con su mismo texto.
  const textosPedido = new Set(pedido.map((f) => f.texto));

  useEffect(() => {
    (async () => {
      const [r, p] = await Promise.all([
        supabase.rpc("rubros_reposicion"),
        supabase
          .from("faltantes_manuales")
          .select("id,texto,resuelto,creado_en")
          .eq("resuelto", false)
          .order("creado_en", { ascending: false }),
      ]);
      setRubros((r.data as RubroConfig[] | null) ?? []);
      setPedido((p.data as FaltanteManual[] | null) ?? []);
    })();
  }, [supabase]);

  async function elegirRubro(rubro: string) {
    setRubroSel(rubro);
    setProds([]);
    if (!rubro) return;
    setCargandoProds(true);
    let query = supabase
      .from("productos")
      .select("id,codigo,descripcion,stock")
      .eq("activo", true)
      .order("descripcion");
    query =
      rubro === "SIN RUBRO"
        ? query.or("rubro.is.null,rubro.eq.SIN RUBRO")
        : query.eq("rubro", rubro);
    const { data } = await query.limit(2000);
    setProds((data as ProductoRubro[] | null) ?? []);
    setCargandoProds(false);
  }

  function toggleProducto(p: ProductoRubro) {
    const texto = p.descripcion ?? p.codigo;
    const yaEsta = textosPedido.has(texto);
    startTransition(async () => {
      if (yaEsta) {
        const { error } = await supabase
          .from("faltantes_manuales")
          .delete()
          .eq("texto", texto)
          .eq("resuelto", false);
        if (error) {
          toast.error(error.message);
          return;
        }
        setPedido((prev) => prev.filter((f) => f.texto !== texto));
      } else {
        const { data, error } = await supabase
          .from("faltantes_manuales")
          .insert({ texto })
          .select("id,texto,resuelto,creado_en")
          .single();
        if (error) {
          toast.error(error.message);
          return;
        }
        setPedido((prev) => [data as FaltanteManual, ...prev]);
      }
    });
  }

  function agregarManual(e: FormEvent) {
    e.preventDefault();
    const texto = nuevo.trim();
    if (!texto) return;
    setNuevo("");
    startTransition(async () => {
      const { data, error } = await supabase
        .from("faltantes_manuales")
        .insert({ texto })
        .select("id,texto,resuelto,creado_en")
        .single();
      if (error) {
        toast.error("No se pudo agregar");
        return;
      }
      setPedido((prev) => [data as FaltanteManual, ...prev]);
    });
  }

  function quitar(f: FaltanteManual) {
    setPedido((prev) => prev.filter((x) => x.id !== f.id));
    startTransition(async () => {
      const { error } = await supabase.from("faltantes_manuales").delete().eq("id", f.id);
      if (error) toast.error("No se pudo quitar");
    });
  }

  function vaciarPedido() {
    if (pedido.length === 0) return;
    const ids = pedido.map((f) => f.id);
    setPedido([]);
    startTransition(async () => {
      await supabase.from("faltantes_manuales").delete().in("id", ids);
    });
  }

  function textoLista(): string {
    const l = ["*Pedido — Lo De Gómez*", ""];
    pedido.forEach((f) => l.push(`• ${f.texto}`));
    return l.join("\n");
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoLista());
      toast.success("Pedido copiado — pegalo en WhatsApp");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      {/* Armar pedido por rubro */}
      <section className="flex w-full flex-col gap-3 lg:max-w-lg">
        <p className="text-sm font-medium">Buscar por rubro</p>
        <select
          value={rubroSel}
          onChange={(e) => elegirRubro(e.target.value)}
          className="h-11 rounded-lg border-2 border-border bg-background px-3 text-base"
        >
          <option value="">Elegí un rubro…</option>
          {rubros.map((r) => (
            <option key={r.rubro} value={r.rubro}>
              {r.rubro} ({r.cant})
            </option>
          ))}
        </select>

        {rubroSel ? (
          cargandoProds ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : prods.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin productos en este rubro.</p>
          ) : (
            <ul className="flex max-h-[60vh] flex-col divide-y overflow-y-auto rounded-xl border">
              {prods.map((p) => {
                const texto = p.descripcion ?? p.codigo;
                const cargado = textosPedido.has(texto);
                return (
                  <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{texto}</p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        quedan {cantidadStr(Number(p.stock))}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={cargado ? "default" : "outline"}
                      onClick={() => toggleProducto(p)}
                      disabled={pending}
                    >
                      {cargado ? (
                        <>
                          <Check className="h-4 w-4" /> Cargado
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4" /> Reponer
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            Elegí un rubro para ver sus productos y tildar cuáles reponer.
          </p>
        )}
      </section>

      {/* Pedido */}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">
            Pedido a reponer{" "}
            <span className="text-muted-foreground">({pedido.length})</span>
          </p>
          {pedido.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={vaciarPedido} disabled={pending}>
              Vaciar
            </Button>
          ) : null}
        </div>

        <form onSubmit={agregarManual} className="flex gap-2">
          <Input
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            placeholder="Cargar a mano (ej: bolsas de 10kg)…"
            className="max-w-md"
          />
          <Button type="submit" disabled={pending || nuevo.trim() === ""}>
            Agregar
          </Button>
        </form>

        {pedido.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            El pedido está vacío. Cargá productos desde un rubro o a mano.
          </p>
        ) : (
          <>
            <ul className="flex flex-col divide-y rounded-xl border">
              {pedido.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="min-w-0 truncate">{f.texto}</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => quitar(f)}
                    aria-label="Quitar"
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button onClick={copiar}>Copiar pedido</Button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(textoLista())}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline">Abrir WhatsApp</Button>
              </a>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
