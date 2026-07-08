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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pesos, cantidadStr } from "@/lib/formato";
import {
  MEDIOS_PAGO,
  type VentaListado,
  type VentaItemDetalle,
  type VentaTicket,
} from "@/lib/types";
import { Ticket } from "../ticket";

const ITEM_COLS = "codigo,descripcion,cantidad,es_pesable,precio_unit,subtotal";

export function VentasCliente({
  ventasIniciales,
}: {
  ventasIniciales: VentaListado[];
}) {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [pending, startTransition] = useTransition();
  const [expandido, setExpandido] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, VentaItemDetalle[]>>({});
  const [cargando, setCargando] = useState<string | null>(null);
  const [ticketReimprimir, setTicketReimprimir] = useState<VentaTicket | null>(null);

  const [busqueda, setBusqueda] = useState("");
  const [resultado, setResultado] = useState<{
    venta: VentaListado;
    items: VentaItemDetalle[];
  } | null>(null);

  // Reimprimir cuando se arma el ticket.
  useEffect(() => {
    if (!ticketReimprimir) return;
    const id = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(id);
  }, [ticketReimprimir]);

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

  function reimprimir(v: VentaListado, its: VentaItemDetalle[]) {
    setTicketReimprimir({
      id: v.id,
      ticket_nro: v.ticket_nro,
      creada_en: v.creada_en,
      medio_pago: v.medio_pago,
      total: Number(v.total),
      total_iva: null,
      items: its,
    });
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
                {medioLabel(resultado.venta.medio_pago)}
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
                        <td className="px-4 py-3">{medioLabel(v.medio_pago)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {pesos(Number(v.total))}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              v.estado === "activa"
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {v.estado}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
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
                        </td>
                      </tr>
                      {abierto ? (
                        <tr className="border-b bg-muted/30 last:border-0">
                          <td></td>
                          <td colSpan={7} className="px-4 py-2">
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

        {/* Precarga del logo para reimprimir sin demora. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/logo.png" alt="" aria-hidden className="hidden" />
      </div>

      <Ticket venta={ticketReimprimir} />
    </>
  );
}
