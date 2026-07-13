"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, ChevronDown, ChevronRight, Settings2, EyeOff, Eye } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cantidadStr } from "@/lib/formato";
import type {
  ProductoReponer,
  FaltanteManual,
  RubroConfig,
} from "@/lib/types";

type ProductoRubro = {
  id: string;
  codigo: string;
  descripcion: string | null;
  stock: number;
  stock_minimo: number | null;
  excluir_reposicion: boolean;
};

export function ReposicionCliente() {
  const [supabase] = useState(() => createClient());
  const [bajo, setBajo] = useState<ProductoReponer[]>([]);
  const [faltantes, setFaltantes] = useState<FaltanteManual[]>([]);
  const [nuevo, setNuevo] = useState("");
  const [cargando, setCargando] = useState(true);
  const [pending, startTransition] = useTransition();

  const [config, setConfig] = useState(false);
  const [rubros, setRubros] = useState<RubroConfig[]>([]);

  async function recargarBajo() {
    const { data } = await supabase.rpc("productos_a_reponer");
    setBajo((data as ProductoReponer[] | null) ?? []);
  }

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [r, f] = await Promise.all([
        supabase.rpc("productos_a_reponer"),
        supabase
          .from("faltantes_manuales")
          .select("id,texto,resuelto,creado_en")
          .eq("resuelto", false)
          .order("creado_en", { ascending: false }),
      ]);
      if (cancelado) return;
      setBajo((r.data as ProductoReponer[] | null) ?? []);
      setFaltantes((f.data as FaltanteManual[] | null) ?? []);
      setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [supabase]);

  async function abrirConfig() {
    setConfig((v) => !v);
    if (rubros.length === 0) {
      const { data } = await supabase.rpc("rubros_reposicion");
      setRubros((data as RubroConfig[] | null) ?? []);
    }
  }

  function agregar(e: FormEvent) {
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
      setFaltantes((prev) => [data as FaltanteManual, ...prev]);
    });
  }

  function resolver(id: string) {
    setFaltantes((prev) => prev.filter((f) => f.id !== id));
    startTransition(async () => {
      const { error } = await supabase
        .from("faltantes_manuales")
        .update({ resuelto: true })
        .eq("id", id);
      if (error) toast.error("No se pudo actualizar");
    });
  }

  function textoLista(): string {
    const l: string[] = ["*Pedido — Lo De Gómez*", ""];
    if (bajo.length) {
      l.push("Stock bajo:");
      bajo.forEach((p) =>
        l.push(`• ${p.descripcion ?? p.codigo} (quedan ${cantidadStr(Number(p.stock))})`),
      );
      l.push("");
    }
    if (faltantes.length) {
      l.push("Faltantes:");
      faltantes.forEach((f) => l.push(`• ${f.texto}`));
    }
    return l.join("\n");
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(textoLista());
      toast.success("Lista copiada — pegala en WhatsApp");
    } catch {
      toast.error("No se pudo copiar");
    }
  }

  const vacio = bajo.length === 0 && faltantes.length === 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <Button onClick={copiar} disabled={vacio}>
          Copiar lista
        </Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(textoLista())}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Button variant="outline" disabled={vacio}>
            Abrir WhatsApp
          </Button>
        </a>
        <Button variant={config ? "default" : "outline"} onClick={abrirConfig}>
          <Settings2 className="h-4 w-4" /> Configurar por rubro
        </Button>
      </div>

      {/* Acordeón por rubro */}
      {config ? (
        <section className="flex flex-col gap-2 rounded-xl border p-3">
          <p className="text-sm font-medium">Rubros</p>
          <p className="text-xs text-muted-foreground">
            Tocá un rubro para ver sus productos. Ponés el mínimo (cuánto tiene que
            quedar para reponer) por producto o de todo el rubro de una, y podés
            sacar de la reposición lo de temporada.
          </p>
          <div className="flex flex-col divide-y">
            {rubros.map((r) => (
              <RubroAcordeon
                key={r.rubro}
                rubro={r}
                supabase={supabase}
                onCambio={recargarBajo}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/* Stock bajo (automático) */}
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          Stock bajo <span className="text-muted-foreground">({bajo.length})</span>
        </p>
        {cargando ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : bajo.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ningún producto bajo el mínimo. Configurá los mínimos por rubro para
            armar la lista. 👌
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Producto</th>
                  <th className="px-4 py-2 font-medium">Rubro</th>
                  <th className="px-4 py-2 text-right font-medium">Quedan</th>
                  <th className="px-4 py-2 text-right font-medium">Mínimo</th>
                </tr>
              </thead>
              <tbody>
                {bajo.map((p) => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="px-4 py-2">{p.descripcion ?? p.codigo}</td>
                    <td className="px-4 py-2 text-muted-foreground">{p.rubro ?? "—"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {cantidadStr(Number(p.stock))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {p.stock_minimo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Faltantes cargados a mano */}
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          Faltantes a mano{" "}
          <span className="text-muted-foreground">({faltantes.length})</span>
        </p>
        <form onSubmit={agregar} className="flex gap-2">
          <Input
            value={nuevo}
            onChange={(e) => setNuevo(e.target.value)}
            placeholder="Ej: bolsas de 10kg, servilletas…"
            className="max-w-md"
          />
          <Button type="submit" disabled={pending || nuevo.trim() === ""}>
            Agregar
          </Button>
        </form>
        {faltantes.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {faltantes.map((f) => (
              <li
                key={f.id}
                className="flex items-center justify-between gap-3 rounded-lg border px-4 py-2 text-sm"
              >
                <span className="min-w-0 truncate">{f.texto}</span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={() => resolver(f.id)}
                  aria-label="Quitar"
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

// Un rubro del acordeón: al abrirlo carga sus productos.
function RubroAcordeon({
  rubro,
  supabase,
  onCambio,
}: {
  rubro: RubroConfig;
  supabase: ReturnType<typeof createClient>;
  onCambio: () => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [prods, setProds] = useState<ProductoRubro[] | null>(null);
  const [cargando, setCargando] = useState(false);
  const [bulk, setBulk] = useState("");
  const [pending, startTransition] = useTransition();

  async function toggle() {
    const nuevoVal = !abierto;
    setAbierto(nuevoVal);
    if (nuevoVal && prods === null) {
      setCargando(true);
      let query = supabase
        .from("productos")
        .select("id,codigo,descripcion,stock,stock_minimo,excluir_reposicion")
        .eq("activo", true)
        .eq("es_pesable", false)
        .order("descripcion");
      query =
        rubro.rubro === "SIN RUBRO"
          ? query.or("rubro.is.null,rubro.eq.SIN RUBRO")
          : query.eq("rubro", rubro.rubro);
      const { data } = await query.limit(1000);
      setProds((data as ProductoRubro[] | null) ?? []);
      setCargando(false);
    }
  }

  function aplicarBulk() {
    const n = bulk.trim() === "" ? 0 : parseInt(bulk, 10);
    if (Number.isNaN(n) || n < 0) {
      toast.error("Poné un número válido");
      return;
    }
    startTransition(async () => {
      const { error } = await supabase.rpc("set_minimo_rubro", {
        p_rubro: rubro.rubro,
        p_minimo: n,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setProds(
        (prev) =>
          prev?.map((p) => ({ ...p, stock_minimo: n > 0 ? n : null })) ?? prev,
      );
      toast.success(n > 0 ? `${rubro.rubro}: mínimo ${n}` : `${rubro.rubro}: sin mínimo`);
      onCambio();
    });
  }

  return (
    <div className="py-1">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent"
      >
        {abierto ? (
          <ChevronDown className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0" />
        )}
        <span className="flex-1 font-medium">{rubro.rubro}</span>
        <span className="text-xs text-muted-foreground">{rubro.cant} prod.</span>
      </button>

      {abierto ? (
        <div className="flex flex-col gap-2 px-2 pb-3 pt-1">
          <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">
              Mínimo para todo el rubro:
            </span>
            <Input
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  aplicarBulk();
                }
              }}
              inputMode="numeric"
              placeholder="0"
              className="h-8 w-16 text-center text-sm"
            />
            <Button size="sm" onClick={aplicarBulk} disabled={pending}>
              Aplicar a todos
            </Button>
          </div>

          {cargando ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : (prods?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Sin productos.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {prods!.map((p) => (
                <FilaProductoRubro
                  key={p.id}
                  producto={p}
                  supabase={supabase}
                  onCambio={onCambio}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

function FilaProductoRubro({
  producto,
  supabase,
  onCambio,
}: {
  producto: ProductoRubro;
  supabase: ReturnType<typeof createClient>;
  onCambio: () => void;
}) {
  const [min, setMin] = useState(
    producto.stock_minimo != null ? String(producto.stock_minimo) : "",
  );
  const [excluido, setExcluido] = useState(producto.excluir_reposicion);
  const [pending, startTransition] = useTransition();

  function guardarMin() {
    const n = min.trim() === "" ? 0 : parseInt(min, 10);
    if (Number.isNaN(n) || n < 0) {
      toast.error("Mínimo inválido");
      return;
    }
    startTransition(async () => {
      const { error } = await supabase
        .from("productos")
        .update({ stock_minimo: n > 0 ? n : null })
        .eq("id", producto.id);
      if (error) {
        toast.error(error.message);
        return;
      }
      onCambio();
    });
  }

  function toggleExcluir() {
    const nuevoVal = !excluido;
    setExcluido(nuevoVal);
    startTransition(async () => {
      const { error } = await supabase.rpc("set_excluir_reposicion", {
        p_id: producto.id,
        p_excluir: nuevoVal,
      });
      if (error) {
        setExcluido(!nuevoVal);
        toast.error(error.message);
        return;
      }
      onCambio();
    });
  }

  return (
    <li className={`flex items-center gap-2 py-2 ${excluido ? "opacity-60" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{producto.descripcion ?? producto.codigo}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          quedan {cantidadStr(Number(producto.stock))}
        </p>
      </div>
      <label className="flex items-center gap-1 text-xs text-muted-foreground">
        mín
        <Input
          value={min}
          onChange={(e) => setMin(e.target.value)}
          onBlur={guardarMin}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              guardarMin();
            }
          }}
          inputMode="numeric"
          placeholder="—"
          className="h-8 w-14 text-center text-sm"
        />
      </label>
      <Button
        size="sm"
        variant="ghost"
        onClick={toggleExcluir}
        disabled={pending}
        title={excluido ? "Volver a incluir en reposición" : "Sacar de reposición (temporada)"}
      >
        {excluido ? (
          <>
            <Eye className="h-4 w-4" /> Incluir
          </>
        ) : (
          <>
            <EyeOff className="h-4 w-4" /> Excluir
          </>
        )}
      </Button>
    </li>
  );
}
