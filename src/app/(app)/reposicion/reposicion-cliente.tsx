"use client";

import { type FormEvent, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cantidadStr } from "@/lib/formato";
import type { ProductoReponer, FaltanteManual } from "@/lib/types";

export function ReposicionCliente() {
  const [supabase] = useState(() => createClient());
  const [bajo, setBajo] = useState<ProductoReponer[]>([]);
  const [faltantes, setFaltantes] = useState<FaltanteManual[]>([]);
  const [nuevo, setNuevo] = useState("");
  const [cargando, setCargando] = useState(true);
  const [pending, startTransition] = useTransition();

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
      </div>

      {/* Stock bajo (automático) */}
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          Stock bajo{" "}
          <span className="text-muted-foreground">({bajo.length})</span>
        </p>
        {cargando ? (
          <p className="text-sm text-muted-foreground">Cargando…</p>
        ) : bajo.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ningún producto bajo el mínimo. 👌
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
                  <tr key={p.codigo} className="border-b last:border-0">
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
