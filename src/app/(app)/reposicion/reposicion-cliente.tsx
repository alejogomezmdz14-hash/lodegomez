"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, EyeOff, RotateCcw, Settings2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cantidadStr } from "@/lib/formato";
import type {
  ProductoReponer,
  FaltanteManual,
  RubroConfig,
} from "@/lib/types";

export function ReposicionCliente() {
  const [supabase] = useState(() => createClient());
  const [bajo, setBajo] = useState<ProductoReponer[]>([]);
  const [faltantes, setFaltantes] = useState<FaltanteManual[]>([]);
  const [nuevo, setNuevo] = useState("");
  const [cargando, setCargando] = useState(true);
  const [pending, startTransition] = useTransition();

  const [config, setConfig] = useState(false);
  const [rubros, setRubros] = useState<RubroConfig[]>([]);
  const [verExcluidos, setVerExcluidos] = useState(false);
  const [excluidos, setExcluidos] = useState<ProductoReponer[]>([]);

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

  function aplicarMinimo(rubro: string, valor: string) {
    const n = valor.trim() === "" ? 0 : parseInt(valor, 10);
    if (Number.isNaN(n) || n < 0) {
      toast.error("Poné un número válido");
      return;
    }
    startTransition(async () => {
      const { error } = await supabase.rpc("set_minimo_rubro", {
        p_rubro: rubro,
        p_minimo: n,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      setRubros((prev) =>
        prev.map((r) =>
          r.rubro === rubro ? { ...r, minimo_actual: n > 0 ? n : null } : r,
        ),
      );
      toast.success(
        n > 0
          ? `${rubro}: mínimo ${n}`
          : `${rubro}: sin mínimo (fuera de reposición)`,
      );
      await recargarBajo();
    });
  }

  function excluir(p: ProductoReponer) {
    setBajo((prev) => prev.filter((x) => x.id !== p.id));
    startTransition(async () => {
      const { error } = await supabase.rpc("set_excluir_reposicion", {
        p_id: p.id,
        p_excluir: true,
      });
      if (error) {
        toast.error(error.message);
        await recargarBajo();
        return;
      }
      toast.success(`${p.descripcion ?? p.codigo} fuera de reposición`);
      setExcluidos([]); // se recarga al abrir
    });
  }

  async function verExcluidosToggle() {
    const nuevoVal = !verExcluidos;
    setVerExcluidos(nuevoVal);
    if (nuevoVal) {
      const { data } = await supabase.rpc("productos_excluidos");
      setExcluidos((data as ProductoReponer[] | null) ?? []);
    }
  }

  function reincluir(p: ProductoReponer) {
    setExcluidos((prev) => prev.filter((x) => x.id !== p.id));
    startTransition(async () => {
      const { error } = await supabase.rpc("set_excluir_reposicion", {
        p_id: p.id,
        p_excluir: false,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success(`${p.descripcion ?? p.codigo} vuelve a reposición`);
      await recargarBajo();
    });
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
        <Button variant="outline" onClick={abrirConfig}>
          <Settings2 className="h-4 w-4" /> Mínimos por rubro
        </Button>
        <Button variant="outline" onClick={verExcluidosToggle}>
          <EyeOff className="h-4 w-4" />{" "}
          {verExcluidos ? "Ocultar excluidos" : "Ver excluidos"}
        </Button>
      </div>

      {/* Config de mínimos por rubro */}
      {config ? (
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <p className="text-sm font-medium">Punto de reposición por rubro</p>
          <p className="text-xs text-muted-foreground">
            El número se aplica a todos los productos del rubro. 0 = sin mínimo
            (ese rubro no entra a la reposición).
          </p>
          <div className="mt-1 grid max-h-96 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
            {rubros.map((r) => (
              <FilaRubro key={r.rubro} rubro={r} onAplicar={aplicarMinimo} pending={pending} />
            ))}
          </div>
        </section>
      ) : null}

      {/* Excluidos (temporada) */}
      {verExcluidos ? (
        <section className="flex flex-col gap-2 rounded-xl border p-4">
          <p className="text-sm font-medium">
            Excluidos de la reposición{" "}
            <span className="text-muted-foreground">({excluidos.length})</span>
          </p>
          {excluidos.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ninguno excluido.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {excluidos.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate">
                    {p.descripcion ?? p.codigo}
                    <span className="text-muted-foreground"> · {p.rubro ?? "—"}</span>
                  </span>
                  <Button size="sm" variant="outline" onClick={() => reincluir(p)} disabled={pending}>
                    <RotateCcw className="h-4 w-4" /> Reincluir
                  </Button>
                </li>
              ))}
            </ul>
          )}
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
                  <th className="px-4 py-2"></th>
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
                    <td className="px-4 py-2 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => excluir(p)}
                        disabled={pending}
                        title="Sacar de la reposición (temporada) sin desactivar la venta"
                      >
                        <EyeOff className="h-4 w-4" /> Excluir
                      </Button>
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

function FilaRubro({
  rubro,
  onAplicar,
  pending,
}: {
  rubro: RubroConfig;
  onAplicar: (rubro: string, valor: string) => void;
  pending: boolean;
}) {
  const [val, setVal] = useState(
    rubro.minimo_actual != null ? String(rubro.minimo_actual) : "",
  );
  return (
    <div className="flex items-center gap-2 rounded-lg border px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{rubro.rubro}</p>
        <p className="text-xs text-muted-foreground">{rubro.cant} productos</p>
      </div>
      <Input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        inputMode="numeric"
        placeholder="0"
        className="h-9 w-16 text-center text-sm"
      />
      <Button size="sm" onClick={() => onAplicar(rubro.rubro, val)} disabled={pending}>
        Aplicar
      </Button>
    </div>
  );
}
