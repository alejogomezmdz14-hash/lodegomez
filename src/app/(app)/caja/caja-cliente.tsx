"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { registrarVenta, anularVenta } from "@/lib/actions/ventas";
import { useScanner } from "@/lib/hooks/use-scanner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pesos, redondear2, parseNumeroAR } from "@/lib/formato";
import { imprimirTicket } from "@/lib/imprimir";
import { NuevoProductoDialog } from "@/components/nuevo-producto-dialog";
import {
  MEDIOS_COBRO,
  type CartItem,
  type MedioPago,
  type Pago,
  type Producto,
  type TicketItem,
  type VentaTicket,
} from "@/lib/types";
import { Carrito } from "./carrito";
import { Buscador } from "./buscador";
import { DialogoPeso } from "./dialogo-peso";
import { SelectorMedio } from "./selector-medio";
import { Ticket } from "./ticket";
import { FacturaPaso } from "./factura-paso";
import { TicketFiscal } from "./ticket-fiscal";
import type { ComprobanteImpresion } from "@/lib/actions/comprobantes";

export function CajaCliente() {
  const [supabase] = useState(() => createClient());
  const codigoRef = useRef<HTMLInputElement>(null);
  const cobrandoRef = useRef(false); // guarda síncrona contra doble cobro
  const buscandoRef = useRef(0); // productos escaneados que todavía no entraron al carrito

  const [codigo, setCodigo] = useState("");
  const [term, setTerm] = useState("");
  const [items, setItems] = useState<CartItem[]>([]);
  const [medio, setMedio] = useState<MedioPago | null>(null);
  const [dividido, setDividido] = useState(false);
  const [montos, setMontos] = useState<Record<MedioPago, string>>({
    efectivo: "",
    qr: "",
    tarjeta: "",
    transferencia: "",
  });
  const [pesable, setPesable] = useState<Producto | null>(null);
  const [altaCodigo, setAltaCodigo] = useState<string | null>(null);
  const [cobrando, setCobrando] = useState(false);
  const [ticket, setTicket] = useState<VentaTicket | null>(null);
  const [postVenta, setPostVenta] = useState<VentaTicket | null>(null);
  const [fiscalPrint, setFiscalPrint] = useState<{
    data: ComprobanteImpresion;
    items: TicketItem[];
  } | null>(null);

  const total = useMemo(
    () => redondear2(items.reduce((s, it) => s + it.subtotal, 0)),
    [items],
  );

  // Pagos a enviar: null = incompleto (no se puede cobrar).
  const pagos = useMemo<Pago[] | null>(() => {
    if (total <= 0) return null;
    if (!dividido) return medio ? [{ medio, monto: total }] : null;
    const lista: Pago[] = [];
    let suma = 0;
    for (const m of MEDIOS_COBRO) {
      const v = parseNumeroAR(montos[m.valor]);
      if (v && v > 0) {
        lista.push({ medio: m.valor, monto: redondear2(v) });
        suma += v;
      }
    }
    if (lista.length === 0) return null;
    return Math.abs(redondear2(suma) - total) < 0.01 ? lista : null;
  }, [total, medio, dividido, montos]);

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
    buscandoRef.current++;
    try {
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
      agregarProducto(data as Producto);
    } finally {
      buscandoRef.current--;
    }
  }

  // Punto único de entrada al carrito (scan y buscador). Un producto sin precio
  // se rechaza ACÁ nombrándolo: antes entraba al carrito en $0 y la venta recién
  // fallaba al cobrar con un error genérico, sin decir cuál ítem era.
  function agregarProducto(p: Producto) {
    const precio = Number((p.es_pesable ? p.precio_por_kg : p.precio_venta) ?? 0);
    if (!(precio > 0)) {
      toast.error(
        `"${p.descripcion ?? p.codigo}" no tiene precio cargado. Cargáselo en Productos para poder venderlo.`,
        { duration: 6000 },
      );
      return;
    }
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
      enabled: pesable === null && altaCodigo === null && postVenta === null,
      ignore: () => codigoRef.current,
    },
  );

  // Imprimir el ticket apenas se registra una venta.
  useEffect(() => {
    if (!ticket) return;
    imprimirTicket();
  }, [ticket]);

  useEffect(() => {
    if (!fiscalPrint) return;
    imprimirTicket();
  }, [fiscalPrint]);

  function onSubmitCodigo(e: FormEvent) {
    e.preventDefault();
    const val = codigo;
    // Enter con el input de código vacío = cobrar (flujo 100% teclado).
    if (val.trim() === "") {
      cobrar();
      return;
    }
    setCodigo("");
    resolverCodigo(val);
    foco();
  }

  // Flechas del teclado: eligen el medio de pago (incluido "Dividir pago").
  // No interfieren con el scanner (que solo mira teclas simples y Enter) ni con
  // tipear montos/buscador (ahí las flechas mueven el cursor normalmente).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (pesable || altaCodigo || postVenta) return;
      // Solo ← y → (es lo que promete el cartelito). Y solo cuando las flechas
      // no le sirven a un input: si está tipeando en cualquier campo —incluido
      // el de código con algo escrito— las flechas mueven el cursor y NO deben
      // cambiar el medio de pago a espaldas del cajero.
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const el = document.activeElement as HTMLElement | null;
      const enInput =
        !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
      const codigoVacio =
        el === codigoRef.current && (codigoRef.current?.value ?? "") === "";
      if (enInput && !codigoVacio) return;
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const opciones: (MedioPago | "dividir")[] = [
        ...MEDIOS_COBRO.map((m) => m.valor),
        "dividir",
      ];
      const actual = dividido
        ? opciones.length - 1
        : medio
          ? opciones.indexOf(medio)
          : -1;
      const next =
        actual < 0
          ? dir > 0
            ? 0
            : opciones.length - 1
          : (actual + dir + opciones.length) % opciones.length;
      const opt = opciones[next];
      if (opt === "dividir") {
        setDividido(true);
        setMedio(null);
      } else {
        setMedio(opt);
        setDividido(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [medio, dividido, pesable, altaCodigo, postVenta]);

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

  function resetPago() {
    setMedio(null);
    setDividido(false);
    setMontos({ efectivo: "", qr: "", tarjeta: "", transferencia: "" });
  }

  async function cobrar() {
    if (cobrandoRef.current) return; // ya hay un cobro en curso → no duplicar
    // Hay un producto escaneado que todavía no entró al carrito: cobrar ahora
    // dejaría la venta corta y el ítem se colaría en la venta siguiente.
    if (buscandoRef.current > 0) {
      toast.warning("Esperá, se está agregando el último producto…");
      return;
    }
    if (items.length === 0) return;
    if (!pagos) {
      toast.error(dividido ? "El pago no cubre el total" : "Elegí un medio de pago");
      return;
    }
    cobrandoRef.current = true;
    // Limpiar impresiones de la venta anterior para que no co-impriman.
    setTicket(null);
    setFiscalPrint(null);
    setCobrando(true);
    try {
      const res = await registrarVenta(
        pagos,
        items.map((it) => ({ producto_id: it.producto_id, cantidad: it.cantidad })),
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setPostVenta(res.venta);
      if (res.venta.items.length !== items.length) {
        toast.warning("Ojo: algunos ítems no se registraron. Revisá el ticket.");
      }
      toast.success(`Venta #${res.venta.ticket_nro} — ${pesos(res.venta.total)}`);
      setItems([]);
      resetPago();
      foco();
    } finally {
      cobrandoRef.current = false;
      setCobrando(false);
    }
  }

  return (
    <>
      <div className="flex h-full min-h-0 flex-col print:hidden lg:flex-row">
        {/* Captura: código + buscador */}
        <section className="flex shrink-0 flex-col gap-3 border-b p-4 lg:w-96 lg:shrink-0 lg:border-b-0 lg:border-r">
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
              agregarProducto(p);
              setTerm("");
              foco();
            }}
          />
        </section>

        {/* Carrito + cobro */}
        <section className="flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-1 flex shrink-0 items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {items.length} ítem{items.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-1">
            {items.length > 0 ? (
              <Button
                onClick={foco}
                className="border-2 border-primary bg-primary/10 font-bold text-primary shadow-sm hover:bg-primary hover:text-primary-foreground"
                title="Volver a agregar productos sin perder la venta"
              >
                ← Seguir agregando
              </Button>
            ) : null}
            {items.length > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setItems([]);
                  resetPago();
                  foco();
                }}
              >
                Vaciar
              </Button>
            ) : null}
            </div>
          </div>

          <Carrito items={items} onInc={inc} onDec={dec} onQuitar={quitar} />

          <div className="mt-3 flex shrink-0 flex-col gap-3 border-t pt-3">
            <div className="flex items-baseline justify-between">
              <span className="text-lg">Total</span>
              <span className="text-3xl font-bold tabular-nums">
                {pesos(total)}
              </span>
            </div>
            <SelectorMedio
              medio={medio}
              dividido={dividido}
              onMedio={(m) => {
                setMedio(m);
                setDividido(false);
              }}
              onDividir={() => {
                setDividido(true);
                setMedio(null);
              }}
            />

            {dividido ? (
              <div className="flex flex-col gap-2">
                {MEDIOS_COBRO.map((m) => (
                  <div key={m.valor} className="flex items-center gap-2">
                    <span className="w-32 text-sm">{m.label}</span>
                    <Input
                      value={montos[m.valor]}
                      onChange={(e) =>
                        setMontos((prev) => ({ ...prev, [m.valor]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          cobrar();
                        }
                      }}
                      inputMode="decimal"
                      placeholder="0"
                      className="h-10"
                    />
                  </div>
                ))}
                <Remanente total={total} montos={montos} />
              </div>
            ) : null}

            <Button
              onClick={cobrar}
              disabled={cobrando || items.length === 0 || !pagos}
              className="h-14 text-lg"
            >
              {cobrando ? "Cobrando…" : "Cobrar"}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Flechas ← → para elegir el pago · Enter para cobrar
            </p>
          </div>
        </section>
      </div>

      <DialogoPeso
        key={pesable?.id ?? "sin-peso"}
        producto={pesable}
        onConfirmar={confirmarPeso}
        onCerrar={() => {
          setPesable(null);
          foco();
        }}
      />

      <NuevoProductoDialog
        key={altaCodigo ?? "sin-alta"}
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

      {postVenta ? (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background p-4 shadow-lg print:hidden">
          <div className="mx-auto max-w-md">
            <FacturaPaso
              ventaId={postVenta.id}
              onVolver={async () => {
                const id = postVenta.id;
                const res = await anularVenta(id, "Cancelada en el momento");
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("Venta cancelada — se devolvió el stock");
                setPostVenta(null);
                foco();
              }}
              onSaltar={() => {
                setTicket(postVenta); // imprime el ticket común (no fiscal)
                setPostVenta(null);
                foco();
              }}
              onListo={(data) => {
                setFiscalPrint({ data, items: postVenta.items });
                setPostVenta(null);
                foco();
              }}
            />
          </div>
        </div>
      ) : null}

      <TicketFiscal
        comprobante={fiscalPrint?.data.comprobante ?? null}
        items={fiscalPrint?.items ?? []}
        qrSvg={fiscalPrint?.data.qr_svg ?? null}
      />

      <Ticket venta={ticket} />
    </>
  );
}

// Indicador de cuánto falta / se pasó en el pago dividido.
function Remanente({
  total,
  montos,
}: {
  total: number;
  montos: Record<MedioPago, string>;
}) {
  const suma = MEDIOS_COBRO.reduce(
    (s, m) => s + (parseNumeroAR(montos[m.valor]) ?? 0),
    0,
  );
  const dif = redondear2(total - suma);
  if (Math.abs(dif) < 0.01) {
    return <p className="text-sm font-medium text-primary">Pago completo ✓</p>;
  }
  if (dif > 0) {
    return <p className="text-sm text-destructive">Falta {pesos(dif)}</p>;
  }
  return <p className="text-sm text-destructive">Se pasó {pesos(-dif)}</p>;
}
