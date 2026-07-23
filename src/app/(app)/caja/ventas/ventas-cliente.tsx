"use client";

import {
  Fragment,
  type FormEvent,
  useEffect,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { anularVenta } from "@/lib/actions/ventas";
import { reintentarComprobante } from "@/lib/actions/comprobantes";
import type { ComprobanteImpresion } from "@/lib/actions/comprobantes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pesos, cantidadStr } from "@/lib/formato";
import { imprimirTicket } from "@/lib/imprimir";
import {
  MEDIOS_PAGO,
  type VentaListado,
  type VentaItemDetalle,
  type VentaTicket,
  type TicketItem,
  type Pago,
  type MedioPago,
} from "@/lib/types";
import { Ticket } from "../ticket";
import { FacturaPaso } from "../factura-paso";
import { TicketFiscal } from "../ticket-fiscal";

const ITEM_COLS = "codigo,descripcion,cantidad,es_pesable,precio_unit,subtotal";

export function VentasCliente({
  ventasIniciales,
  fiscales,
}: {
  ventasIniciales: VentaListado[];
  fiscales: Record<string, { estado: string; tipo: string | null }>;
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [pending, startTransition] = useTransition();
  const [expandido, setExpandido] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, VentaItemDetalle[]>>({});
  const [cargando, setCargando] = useState<string | null>(null);
  const [ticketReimprimir, setTicketReimprimir] = useState<VentaTicket | null>(null);
  const [facturarPanel, setFacturarPanel] = useState<VentaListado | null>(null);
  const [fiscalPrint, setFiscalPrint] = useState<{
    data: ComprobanteImpresion;
    items: TicketItem[];
  } | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [resultado, setResultado] = useState<{
    venta: VentaListado;
    items: VentaItemDetalle[];
  } | null>(null);

  // Reimprimir cuando se arma el ticket.
  useEffect(() => {
    if (!ticketReimprimir) return;
    imprimirTicket();
  }, [ticketReimprimir]);

  useEffect(() => {
    if (!fiscalPrint) return;
    imprimirTicket();
  }, [fiscalPrint]);

  async function toggle(v: VentaListado) {
    if (expandido === v.id) {
      setExpandido(null);
      return;
    }
    setExpandido(v.id);
    if (!items[v.id]) {
      setCargando(v.id);
      const { data } = await supabase
        .from("venta_items")
        .select(ITEM_COLS)
        .eq("venta_id", v.id);
      setItems((prev) => ({
        ...prev,
        [v.id]: (data as VentaItemDetalle[] | null) ?? [],
      }));
      setCargando(null);
    }
  }

  async function reimprimir(v: VentaListado, its: VentaItemDetalle[]) {
    let pagos: Pago[] | undefined;
    if (v.es_mixto) {
      const { data } = await supabase
        .from("venta_pagos")
        .select("medio_pago,monto")
        .eq("venta_id", v.id);
      pagos = (data ?? []).map((p) => ({
        medio: p.medio_pago as MedioPago,
        monto: Number(p.monto),
      }));
    }
    setFiscalPrint(null);
    setTicketReimprimir({
      id: v.id,
      ticket_nro: v.ticket_nro,
      creada_en: v.creada_en,
      medio_pago: v.medio_pago,
      es_mixto: v.es_mixto,
      total: Number(v.total),
      total_iva: null,
      items: its,
      pagos,
    });
  }

  // Imprime el ticket fiscal de una venta recién facturada.
  async function imprimirFiscal(ventaId: string, data: ComprobanteImpresion) {
    const { data: its } = await supabase
      .from("venta_items")
      .select(ITEM_COLS)
      .eq("venta_id", ventaId);
    setTicketReimprimir(null);
    setFiscalPrint({ data, items: (its as TicketItem[] | null) ?? [] });
  }

  function anular(v: VentaListado) {
    const motivo = window.prompt(
      `Anular ticket #${v.ticket_nro} (${pesos(Number(v.total))}).\nMotivo:`,
    );
    if (motivo === null) return;
    startTransition(async () => {
      const res = await anularVenta(v.id, motivo);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `Ticket #${res.ticket_nro} anulado — aviso enviado a los dueños`,
      );
      router.refresh();
    });
  }

  async function buscar(e: FormEvent) {
    e.preventDefault();
    const n = parseInt(busqueda.trim(), 10);
    if (!Number.isInteger(n)) {
      toast.error("Poné un número de ticket");
      return;
    }
    const { data: v } = await supabase
      .from("ventas")
      .select("id,ticket_nro,creada_en,medio_pago,total,estado,cierre_id")
      .eq("ticket_nro", n)
      .maybeSingle();
    if (!v) {
      setResultado(null);
      toast.error(`No existe el ticket #${n}`);
      return;
    }
    const { data: its } = await supabase
      .from("venta_items")
      .select(ITEM_COLS)
      .eq("venta_id", (v as { id: string }).id);
    setResultado({
      venta: { ...(v as VentaListado), empleado_nombre: null },
      items: (its as VentaItemDetalle[] | null) ?? [],
    });
  }

  const medioLabel = (m: string) =>
    MEDIOS_PAGO.find((x) => x.valor === m)?.label ?? m;

  function etiquetaFiscal(id: string): string {
    const f = fiscales[id];
    if (!f) return "Sin factura";
    if (f.estado === "emitido") return `Factura ${f.tipo}`;
    if (f.estado === "pendiente") return "Pendiente";
    return "Error";
  }

  function abrirFacturar(v: VentaListado) {
    setFacturarPanel(v);
  }

  function reintentar(v: VentaListado) {
    startTransition(async () => {
      const res = await reintentarComprobante(v.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Factura reemitida para #${v.ticket_nro}`);
      await imprimirFiscal(v.id, res.data);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-col gap-4 print:hidden">
        {/* Buscar ticket por número */}
        <form onSubmit={buscar} className="flex gap-2">
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            inputMode="numeric"
            placeholder="Buscar ticket por número…"
            className="max-w-xs"
          />
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </form>

        {resultado ? (
          <div className="flex flex-col gap-2 rounded-xl border border-primary/40 bg-accent/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">
                Ticket #{resultado.venta.ticket_nro} ·{" "}
                {new Date(resultado.venta.creada_en).toLocaleString("es-AR", {
                  day: "2-digit",
                  month: "2-digit",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                · {pesos(Number(resultado.venta.total))} ·{" "}
                {resultado.venta.es_mixto
                  ? "Mixto"
                  : medioLabel(resultado.venta.medio_pago)}
              </span>
              <Button
                size="sm"
                onClick={() => reimprimir(resultado.venta, resultado.items)}
              >
                <Printer className="h-4 w-4" /> Reimprimir
              </Button>
            </div>
            <ul className="flex flex-col gap-0.5 text-sm">
              {resultado.items.map((it, i) => (
                <li key={i} className="flex justify-between gap-4">
                  <span className="min-w-0 truncate">
                    {it.descripcion || it.codigo}
                    <span className="text-muted-foreground">
                      {" · "}
                      {it.es_pesable
                        ? `${cantidadStr(Number(it.cantidad))} kg`
                        : `${it.cantidad} u`}
                    </span>
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {pesos(Number(it.subtotal))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {ventasIniciales.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay ventas todavía.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="w-8 px-2 py-3"></th>
                  <th className="px-4 py-3 font-medium">Ticket</th>
                  <th className="px-4 py-3 font-medium">Hora</th>
                  <th className="px-4 py-3 font-medium">Empleado</th>
                  <th className="px-4 py-3 font-medium">Medio</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Fiscal</th>
                  <th className="px-4 py-3 font-medium">Estado</th>
                  <th className="px-4 py-3 text-right font-medium">Acción</th>
                </tr>
              </thead>
              <tbody>
                {ventasIniciales.map((v) => {
                  const abierto = expandido === v.id;
                  const puedeAnular = v.estado === "activa" && v.cierre_id === null;
                  return (
                    <Fragment key={v.id}>
                      <tr
                        className="cursor-pointer border-b last:border-0 hover:bg-accent/50"
                        onClick={() => toggle(v)}
                      >
                        <td className="px-2 py-3 text-muted-foreground">
                          {abierto ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-4 py-3 tabular-nums">#{v.ticket_nro}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {new Date(v.creada_en).toLocaleTimeString("es-AR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="px-4 py-3">{v.empleado_nombre ?? "—"}</td>
                        <td className="px-4 py-3">
                          {v.es_mixto ? "Mixto" : medioLabel(v.medio_pago)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {pesos(Number(v.total))}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {etiquetaFiscal(v.id)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                v.estado === "activa"
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {v.estado}
                            </span>
                            {v.estado === "activa" ? (
                              <span
                                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                                title={
                                  v.cierre_id
                                    ? "Ya entró en un cierre de caja"
                                    : "Todavía en la caja abierta (sin cerrar)"
                                }
                              >
                                {v.cierre_id ? "cerrada" : "en caja"}
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            {v.estado === "activa" && etiquetaFiscal(v.id) === "Sin factura" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  abrirFacturar(v);
                                }}
                              >
                                Facturar
                              </Button>
                            ) : null}
                            {v.estado === "activa" &&
                            (etiquetaFiscal(v.id) === "Error" ||
                              etiquetaFiscal(v.id) === "Pendiente") ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={pending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  reintentar(v);
                                }}
                              >
                                Reintentar
                              </Button>
                            ) : null}
                            {puedeAnular ? (
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={pending}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  anular(v);
                                }}
                              >
                                Anular
                              </Button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {abierto ? (
                        <tr className="border-b bg-muted/30 last:border-0">
                          <td></td>
                          <td colSpan={8} className="px-4 py-2">
                            {cargando === v.id ? (
                              <p className="text-muted-foreground">Cargando…</p>
                            ) : (items[v.id]?.length ?? 0) === 0 ? (
                              <p className="text-muted-foreground">Sin ítems.</p>
                            ) : (
                              <div className="flex flex-col gap-2 py-1">
                                <ul className="flex flex-col gap-1">
                                  {items[v.id].map((it, i) => (
                                    <li key={i} className="flex justify-between gap-4">
                                      <span className="min-w-0 truncate">
                                        {it.descripcion || it.codigo}
                                        <span className="text-muted-foreground">
                                          {" · "}
                                          {it.es_pesable
                                            ? `${cantidadStr(Number(it.cantidad))} kg`
                                            : `${it.cantidad} u`}{" "}
                                          × {pesos(Number(it.precio_unit))}
                                        </span>
                                      </span>
                                      <span className="shrink-0 tabular-nums">
                                        {pesos(Number(it.subtotal))}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                                <div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => reimprimir(v, items[v.id])}
                                  >
                                    <Printer className="h-4 w-4" /> Reimprimir
                                  </Button>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>

      {facturarPanel ? (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background p-4 shadow-lg print:hidden">
          <div className="mx-auto max-w-md">
            <FacturaPaso
              ventaId={facturarPanel.id}
              onSaltar={() => setFacturarPanel(null)}
              onListo={async (data) => {
                const v = facturarPanel;
                setFacturarPanel(null);
                if (v) await imprimirFiscal(v.id, data);
                router.refresh();
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

      <Ticket venta={ticketReimprimir} />
    </>
  );
}
