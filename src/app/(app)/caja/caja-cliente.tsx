"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { registrarVenta } from "@/lib/actions/ventas";
import { useScanner } from "@/lib/hooks/use-scanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pesos, redondear2 } from "@/lib/formato";
import { imprimirTicket } from "@/lib/imprimir";
import { NuevoProductoDialog } from "@/components/nuevo-producto-dialog";
import type { CartItem, MedioPago, Producto, VentaTicket } from "@/lib/types";
import { Carrito } from "./carrito";
import { Buscador } from "./buscador";
import { DialogoPeso } from "./dialogo-peso";
import { SelectorMedio } from "./selector-medio";
import { Ticket } from "./ticket";

export function CajaCliente() {
  const [supabase] = useState(() => createClient());
  const codigoRef = useRef<HTMLInputElement>(null);

  const [codigo, setCodigo] = useState("");
  const [term, setTerm] = useState("");
  const [items, setItems] = useState<CartItem[]>([]);
  const [medio, setMedio] = useState<MedioPago | null>(null);
  const [pesable, setPesable] = useState<Producto | null>(null);
  const [altaCodigo, setAltaCodigo] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [ticket, setTicket] = useState<VentaTicket | null>(null);

  const total = useMemo(
    () => redondear2(items.reduce((s, it) => s + it.subtotal, 0)),
    [items],
  );

  function foco() {
    codigoRef.current?.focus();
  }

  function agregarNormal(p: Producto) {
    const precio = Number(p.precio_venta ?? 0);
    setItems((prev) => {
      const idx = prev.findIndex(
        (it) => it.producto_id === p.id && !it.es_pesable,
      );
      if (idx >= 0) {
        const copy = [...prev];
        const it = copy[idx];
        const cantidad = it.cantidad + 1;
        copy[idx] = {
          ...it,
          cantidad,
          subtotal: redondear2(cantidad * it.precio_unit),
        };
        return copy;
      }
      return [
        ...prev,
        {
          producto_id: p.id,
          codigo: p.codigo,
          descripcion: p.descripcion ?? p.codigo,
          cantidad: 1,
          es_pesable: false,
          precio_unit: precio,
          iva_pct: Number(p.iva_pct ?? 21),
          subtotal: redondear2(precio),
        },
      ];
    });
  }

  function agregarPesable(p: Producto, kg: number) {
    const precio = Number(p.precio_por_kg ?? 0);
    setItems((prev) => [
      ...prev,
      {
        producto_id: p.id,
        codigo: p.codigo,
        descripcion: p.descripcion ?? p.codigo,
        cantidad: kg,
        es_pesable: true,
        precio_unit: precio,
        iva_pct: Number(p.iva_pct ?? 21),
        subtotal: redondear2(kg * precio),
      },
    ]);
  }

  async function resolverCodigo(cod: string) {
    const c = cod.trim();
    if (!c) return;
    const { data, error } = await supabase
      .from("productos")
      .select("*")
      .eq("codigo", c)
      .eq("activo", true)
      .maybeSingle();
    if (error) {
      toast.error("Error al buscar el producto");
      return;
    }
    if (!data) {
      setAltaCodigo(c); // no existe → ofrecer darlo de alta con ese código
      return;
    }
    const p = data as Producto;
    if (p.es_pesable) setPesable(p);
    else agregarNormal(p);
  }

  // Scanner global: red de seguridad para el scan cuando el foco está en el
  // buscador. Se pausa mientras el diálogo de peso está abierto (ahí Enter
  // confirma el peso).
  useScanner(
    (code) => {
      setTerm(""); // si el scan cayó en el buscador, borralo
      resolverCodigo(code);
      foco();
    },
    {
      enabled: pesable === null && altaCodigo === null,
      ignore: () => codigoRef.current,
    },
  );

  // Imprimir el ticket apenas se registra una venta.
  useEffect(() => {
    if (!ticket) return;
    imprimirTicket();
  }, [ticket]);

  function onSubmitCodigo(e: FormEvent) {
    e.preventDefault();
    const val = codigo;
    setCodigo("");
    resolverCodigo(val);
    foco();
  }

  function inc(i: number) {
    setItems((prev) => {
      const copy = [...prev];
      const it = copy[i];
      const cantidad = it.cantidad + 1;
      copy[i] = { ...it, cantidad, subtotal: redondear2(cantidad * it.precio_unit) };
      return copy;
    });
  }

  function dec(i: number) {
    setItems((prev) => {
      const copy = [...prev];
      const it = copy[i];
      const cantidad = it.cantidad - 1;
      if (cantidad <= 0) {
        copy.splice(i, 1);
        return copy;
      }
      copy[i] = { ...it, cantidad, subtotal: redondear2(cantidad * it.precio_unit) };
      return copy;
    });
  }

  function quitar(i: number) {
    setItems((prev) => prev.filter((_, j) => j !== i));
  }

  function confirmarPeso(kg: number) {
    if (pesable) agregarPesable(pesable, kg);
    setPesable(null);
    foco();
  }

  async function cobrar() {
    if (items.length === 0) return;
    if (!medio) {
      toast.error("Elegí un medio de pago");
      return;
    }
    setCobrando(true);
    const res = await registrarVenta(
      medio,
      items.map((it) => ({ producto_id: it.producto_id, cantidad: it.cantidad })),
    );
    setCobrando(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setTicket(res.venta);
    if (res.venta.items.length !== items.length) {
      toast.warning("Ojo: algunos ítems no se registraron. Revisá el ticket.");
    }
    toast.success(`Venta #${res.venta.ticket_nro} — ${pesos(res.venta.total)}`);
    setItems([]);
    setMedio(null);
    foco();
  }

  return (
    <>
      <div className="flex flex-1 flex-col print:hidden lg:flex-row">
        {/* Captura: código + buscador */}
        <section className="flex flex-col gap-3 border-b p-4 lg:w-96 lg:shrink-0 lg:border-b-0 lg:border-r">
          <form onSubmit={onSubmitCodigo}>
            <Input
              ref={codigoRef}
              autoFocus
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Código — escaneá o tipeá y Enter"
              className="h-12 text-lg"
              autoComplete="off"
            />
          </form>
          <Buscador
            term={term}
            onTermChange={setTerm}
            onElegir={(p) => {
              if (p.es_pesable) setPesable(p);
              else agregarNormal(p);
              setTerm("");
              foco();
            }}
          />
        </section>

        {/* Carrito + cobro */}
        <section className="flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {items.length} ítem{items.length === 1 ? "" : "s"}
            </span>
            {items.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setItems([]);
                  setMedio(null);
                  foco();
                }}
              >
                Vaciar
              </Button>
            ) : null}
          </div>

          <Carrito items={items} onInc={inc} onDec={dec} onQuitar={quitar} />

          <div className="mt-3 flex flex-col gap-3 border-t pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-lg">Total</span>
              <span className="text-3xl font-bold tabular-nums">
                {pesos(total)}
              </span>
            </div>
            <SelectorMedio value={medio} onChange={setMedio} />
            <Button
              onClick={cobrar}
              disabled={cobrando || items.length === 0}
              className="h-14 text-lg"
            >
              {cobrando ? "Cobrando…" : "Cobrar"}
            </Button>
          </div>
        </section>
      </div>

      <DialogoPeso
        key={pesable?.id ?? "sin"}
        producto={pesable}
        onConfirmar={confirmarPeso}
        onCerrar={() => {
          setPesable(null);
          foco();
        }}
      />

      <NuevoProductoDialog
        key={altaCodigo ?? "sin"}
        abierto={altaCodigo !== null}
        codigoInicial={altaCodigo ?? ""}
        onCerrar={() => {
          setAltaCodigo(null);
          foco();
        }}
        onCreado={(p) => {
          setAltaCodigo(null);
          if (p.es_pesable) setPesable(p);
          else agregarNormal(p);
          foco();
        }}
      />

      <Ticket venta={ticket} />
    </>
  );
}
