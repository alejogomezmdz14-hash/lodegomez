"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { pesos } from "@/lib/formato";
import type { Producto } from "@/lib/types";

export function Buscador({ onElegir }: { onElegir: (p: Producto) => void }) {
  const [term, setTerm] = useState("");
  const [resultados, setResultados] = useState<Producto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    const q = term.trim();
    const t = setTimeout(async () => {
      if (q.length < 2) {
        setResultados([]);
        setBuscando(false);
        return;
      }
      setBuscando(true);
      const { data } = await supabase
        .from("productos")
        .select("*")
        .ilike("descripcion", `%${q}%`)
        .eq("activo", true)
        .limit(20);
      setResultados((data as Producto[] | null) ?? []);
      setBuscando(false);
    }, 250);
    return () => clearTimeout(t);
  }, [term, supabase]);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Input
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Buscar por nombre…"
        className="h-11 text-base"
      />
      {resultados.length > 0 ? (
        <ul className="flex min-h-0 flex-col gap-1 overflow-y-auto rounded-lg border p-1">
          {resultados.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onElegir(p);
                  setTerm("");
                  setResultados([]);
                }}
                className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <span className="min-w-0 truncate">{p.descripcion}</span>
                <span className="shrink-0 font-medium tabular-nums">
                  {pesos(Number(p.precio_venta ?? 0))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : term.trim().length >= 2 && !buscando ? (
        <p className="px-1 text-sm text-muted-foreground">Sin resultados.</p>
      ) : null}
    </div>
  );
}
