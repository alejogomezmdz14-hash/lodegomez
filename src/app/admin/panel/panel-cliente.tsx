"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { pesos, cantidadStr } from "@/lib/formato";
import { Input } from "@/components/ui/input";
import type {
  MetricasPeriodo,
  RankingItem,
  EventoDueno,
  TipoEvento,
  VentaPorEmpleado,
  EgresosPeriodo,
  GastoPorPersona,
} from "@/lib/types";

// El ranking tiene su propio período: el histórico es el que sirve para decidir
// qué reponer, más allá de lo que se esté mirando arriba.
type RankPeriodo = "historico" | "mes" | "semana";
type RankOrden = "facturado" | "unidades" | "ganancia";

const RANK_PERIODOS: { id: RankPeriodo; label: string }[] = [
  { id: "historico", label: "Histórico" },
  { id: "mes", label: "Último mes" },
  { id: "semana", label: "Última semana" },
];

function rangoRank(p: RankPeriodo): { desde: string | null; hasta: string | null } {
  if (p === "historico") return { desde: null, hasta: null };
  const d = new Date();
  d.setDate(d.getDate() - (p === "mes" ? 30 : 7));
  return { desde: d.toISOString(), hasta: null };
}

type Preset = "hoy" | "ayer" | "semana" | "mes";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "semana", label: "7 días" },
  { id: "mes", label: "Este mes" },
];

const EVENTO_LABEL: Record<TipoEvento, string> = {
  anulacion: "Anulación",
  devolucion: "Devolución",
  alerta_precio: "Alerta de precio",
};

// Rango en hora local (la PC del mostrador está en Argentina).
function rango(p: Preset): { desde: string; hasta: string } {
  const ahora = new Date();
  const inicioHoy = new Date(ahora);
  inicioHoy.setHours(0, 0, 0, 0);
  if (p === "ayer") {
    const ayer = new Date(inicioHoy);
    ayer.setDate(ayer.getDate() - 1);
    return { desde: ayer.toISOString(), hasta: inicioHoy.toISOString() };
  }
  if (p === "semana") {
    const d = new Date(inicioHoy);
    d.setDate(d.getDate() - 6);
    return { desde: d.toISOString(), hasta: ahora.toISOString() };
  }
  if (p === "mes") {
    const primero = new Date(inicioHoy.getFullYear(), inicioHoy.getMonth(), 1);
    return { desde: primero.toISOString(), hasta: ahora.toISOString() };
  }
  return { desde: inicioHoy.toISOString(), hasta: ahora.toISOString() };
}

// Rango de un día puntual elegido en el calendario (hora local del navegador).
function rangoDiaLocal(dia: string): { desde: string; hasta: string } {
  const d = new Date(`${dia}T00:00:00`);
  const hasta = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  return { desde: d.toISOString(), hasta: hasta.toISOString() };
}

// Rango de un mes entero ("2026-07") -> [1 del mes, 1 del mes siguiente).
function rangoMesLocal(mes: string): { desde: string; hasta: string } {
  const [a, m] = mes.split("-").map(Number);
  const desde = new Date(a, m - 1, 1);
  const hasta = new Date(a, m, 1);
  return { desde: desde.toISOString(), hasta: hasta.toISOString() };
}

export function PanelCliente() {
  const [supabase] = useState(() => createClient());
  const [preset, setPreset] = useState<Preset>("hoy");
  const [dia, setDia] = useState(""); // día puntual del calendario (vacío = usar preset)
  const [mes, setMes] = useState(""); // mes entero (vacío = no usar)
  const [metricas, setMetricas] = useState<MetricasPeriodo | null>(null);
  const [ranking, setRanking] = useState<RankingItem[]>([]);
  const [rentables, setRentables] = useState<RankingItem[]>([]);
  const [rankPeriodo, setRankPeriodo] = useState<RankPeriodo>("historico");
  const [rankOrden, setRankOrden] = useState<RankOrden>("facturado");
  const [eventos, setEventos] = useState<EventoDueno[]>([]);
  const [porEmpleado, setPorEmpleado] = useState<VentaPorEmpleado[]>([]);
  const [egresos, setEgresos] = useState<EgresosPeriodo | null>(null);
  const [gastos, setGastos] = useState<GastoPorPersona[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelado = false;
    const { desde, hasta } = dia
      ? rangoDiaLocal(dia)
      : mes
        ? rangoMesLocal(mes)
        : rango(preset);
    (async () => {
      setCargando(true);
      const [m, e, emp, egr, gp] = await Promise.all([
        supabase.rpc("metricas_periodo", { p_desde: desde, p_hasta: hasta }),
        supabase
          .from("eventos_duenos")
          .select("*")
          .order("creado_en", { ascending: false })
          .limit(30),
        supabase.rpc("ventas_por_empleado", { p_desde: desde, p_hasta: hasta }),
        supabase.rpc("egresos_periodo", { p_desde: desde, p_hasta: hasta }),
        supabase.rpc("gastos_por_persona", { p_desde: desde, p_hasta: hasta }),
      ]);
      if (cancelado) return;
      if (m.error || e.error || emp.error || egr.error || gp.error) {
        setError(true);
      } else {
        setError(false);
        setMetricas((m.data as MetricasPeriodo | null) ?? null);
        setEventos((e.data as EventoDueno[] | null) ?? []);
        setPorEmpleado((emp.data as VentaPorEmpleado[] | null) ?? []);
        setEgresos((egr.data as EgresosPeriodo | null) ?? null);
        setGastos((gp.data as GastoPorPersona[] | null) ?? []);
      }
      setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [preset, dia, mes, supabase]);

  // Ranking: período propio (histórico por defecto) y orden elegible.
  useEffect(() => {
    let cancelado = false;
    const { desde, hasta } = rangoRank(rankPeriodo);
    Promise.all([
      supabase.rpc("ranking_productos", {
        p_desde: desde,
        p_hasta: hasta,
        p_limite: 25,
        p_orden: rankOrden,
      }),
      // "Más rentables": ordenado por % de ganancia, no por plata.
      supabase.rpc("ranking_productos", {
        p_desde: desde,
        p_hasta: hasta,
        p_limite: 15,
        p_orden: "rentable",
      }),
    ]).then(([r, rent]) => {
      if (cancelado) return;
      setRanking((r.data as RankingItem[] | null) ?? []);
      setRentables((rent.data as RankingItem[] | null) ?? []);
    });
    return () => {
      cancelado = true;
    };
  }, [rankPeriodo, rankOrden, supabase]);

  async function marcarLeido(id: string) {
    setEventos((prev) =>
      prev.map((ev) => (ev.id === id ? { ...ev, leido: true } : ev)),
    );
    const { error: err } = await supabase
      .from("eventos_duenos")
      .update({ leido: true })
      .eq("id", id);
    if (err) {
      setEventos((prev) =>
        prev.map((ev) => (ev.id === id ? { ...ev, leido: false } : ev)),
      );
      toast.error("No se pudo marcar como leído");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Rango */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.id}
            variant={!dia && !mes && preset === p.id ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setDia("");
              setMes("");
              setPreset(p.id);
            }}
          >
            {p.label}
          </Button>
        ))}
        <span className="mx-1 text-muted-foreground">·</span>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Día
          <Input
            type="date"
            value={dia}
            onChange={(e) => {
              setDia(e.target.value);
              if (e.target.value) setMes("");
            }}
            className="h-8 w-auto text-sm"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Mes
          <Input
            type="month"
            value={mes}
            onChange={(e) => {
              setMes(e.target.value);
              if (e.target.value) setDia("");
            }}
            className="h-8 w-auto text-sm"
          />
        </label>
        {dia || mes ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDia("");
              setMes("");
            }}
          >
            Ver período
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          No se pudieron cargar los datos. Revisá la conexión y volvé a intentar.
        </p>
      ) : null}

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metrica label="Vendido" valor={pesos(Number(metricas?.total ?? 0))} destacado />
        <Metrica label="Ganancia" valor={pesos(Number(metricas?.margen ?? 0))} destacado />
        <Metrica label="Tickets" valor={String(metricas?.cant_tickets ?? 0)} />
        <Metrica
          label="Anulaciones"
          valor={String(metricas?.anulaciones ?? 0)}
          alerta={(metricas?.anulaciones ?? 0) > 0}
        />
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        Ganancia = precio − costo de cada producto vendido. Solo cuenta los que
        tienen el costo cargado (cargalos en Productos para que sea exacta).
        “Vendido” y “Ganancia” <strong>no incluyen ningún gasto</strong> —ni la
        casa, ni el local, ni los empleados—: ahí no entró plata al cajón.
      </p>

      {/* Mercadería que salió sin cobrar */}
      <Card className="flex flex-col gap-3 border-amber-300 bg-amber-50/60 p-4">
        <p className="text-sm font-medium text-amber-900">
          Mercadería que salió sin cobrar
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <GastoTotal
            label="Casa (al costo)"
            v={metricas?.cuenta_corriente}
          />
          <GastoTotal label="Local (al costo)" v={metricas?.gasto_local} />
          <GastoTotal
            label="Empleados (lo pagan)"
            v={metricas?.gasto_empleado}
          />
        </div>
        {/* El desglose por persona es solo de empleados: casa y local son una
            sola cuenta del negocio. */}
        {gastos.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium text-amber-900">
              Cuánto se llevó cada empleado
            </p>
            <div className="overflow-x-auto rounded-lg border border-amber-200 bg-background">
              <table className="w-full text-left text-sm">
                <thead className="border-b text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Empleado</th>
                    <th className="px-3 py-2 text-right font-medium">Veces</th>
                    <th className="px-3 py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {gastos.map((g, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="px-3 py-2">{g.persona}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {g.tickets}
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {pesos(Number(g.total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
        <span className="text-xs text-amber-800/80">
          Casa y local son una sola cuenta del negocio. Para ver qué se llevó
          cada uno, entrá a Ventas y abrí el ticket.
        </span>
      </Card>

      {/* Medios de pago */}
      <Card className="flex flex-col gap-2 p-4">
        <p className="text-sm font-medium">Por medio de pago</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          <MedioFila label="Efectivo" v={metricas?.efectivo} />
          <MedioFila label="Tarjeta" v={metricas?.tarjeta} />
          <MedioFila label="Transferencia" v={metricas?.transferencia} />
          {/* QR ya no se usa al cobrar, pero las ventas viejas lo tienen: si no
              se muestra, la suma de los medios no cuadra con "Vendido". */}
          {Number(metricas?.qr ?? 0) > 0 ? (
            <MedioFila label="QR (ventas viejas)" v={metricas?.qr} />
          ) : null}
        </div>
      </Card>

      {/* Egresos */}
      <Card className="flex flex-col gap-2 p-4">
        <p className="text-sm font-medium">Egresos (retiros + pagos a proveedores)</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
          <MedioFila label="Retiros de caja" v={egresos?.retiros} />
          <MedioFila label="Proveedores (efec.)" v={egresos?.prov_efectivo} />
          <MedioFila label="Proveedores (transf.)" v={egresos?.prov_transferencia} />
          <MedioFila
            label="Total egresos"
            v={
              Number(egresos?.retiros ?? 0) +
              Number(egresos?.prov_efectivo ?? 0) +
              Number(egresos?.prov_transferencia ?? 0)
            }
          />
        </div>
      </Card>

      {/* Ranking de productos: tiene su propio período (el histórico es el que
          más sirve para decidir qué reponer) y se puede ordenar. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Ranking de productos</p>
          <div className="flex flex-wrap items-center gap-1">
            {RANK_PERIODOS.map((p) => (
              <Button
                key={p.id}
                variant={rankPeriodo === p.id ? "default" : "outline"}
                size="sm"
                onClick={() => setRankPeriodo(p.id)}
              >
                {p.label}
              </Button>
            ))}
            <span className="mx-1 text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">Ordenar por</span>
            <select
              value={rankOrden}
              onChange={(e) => setRankOrden(e.target.value as RankOrden)}
              className="h-8 rounded-md border border-border bg-background px-2 text-sm"
            >
              <option value="facturado">Facturado</option>
              <option value="unidades">Cantidad</option>
              <option value="ganancia">Ganancia</option>
            </select>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Producto</th>
                <th className="px-4 py-2 text-right font-medium">Cantidad</th>
                <th className="px-4 py-2 text-right font-medium">Facturado</th>
                <th className="px-4 py-2 text-right font-medium">Ganancia</th>
                <th className="px-4 py-2 text-right font-medium">Margen</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    {cargando ? "Cargando…" : "Sin ventas en el período."}
                  </td>
                </tr>
              ) : (
                ranking.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">
                      {i + 1}
                    </td>
                    <td className="px-4 py-2">{r.descripcion || r.codigo}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {cantidadStr(Number(r.unidades))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {pesos(Number(r.facturado))}
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-primary">
                      {pesos(Number(r.margen))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {r.margen_pct == null ? "—" : `${Number(r.margen_pct)}%`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          No incluye lo que sale como gasto (casa, local, empleados). “Margen” es
          lo que le sacás sobre lo facturado; sale “—” si a ese producto todavía
          no le cargaste el costo.
        </p>
      </div>

      {/* Más rentables: ordenado por % y no por plata. Responde "de lo que
          vendo, ¿a qué le saco más?" — un producto puede vender muchísimo y
          dejar poco (cigarrillos) y otro vender menos y dejar mucho. */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          Productos más rentables{" "}
          <span className="font-normal text-muted-foreground">
            — a los que más les sacás
          </span>
        </p>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Producto</th>
                <th className="px-4 py-2 text-right font-medium">Margen</th>
                <th className="px-4 py-2 text-right font-medium">Ganancia</th>
                <th className="px-4 py-2 text-right font-medium">Cantidad</th>
                <th className="px-4 py-2 text-right font-medium">Facturado</th>
              </tr>
            </thead>
            <tbody>
              {rentables.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">
                    {cargando
                      ? "Cargando…"
                      : "Todavía no hay productos con el costo cargado."}
                  </td>
                </tr>
              ) : (
                rentables.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2 tabular-nums text-muted-foreground">
                      {i + 1}
                    </td>
                    <td className="px-4 py-2">{r.descripcion || r.codigo}</td>
                    <td className="px-4 py-2 text-right text-base font-bold tabular-nums text-primary">
                      {Number(r.margen_pct)}%
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {pesos(Number(r.margen))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {cantidadStr(Number(r.unidades))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {pesos(Number(r.facturado))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Solo productos con el costo cargado y con movimiento real (5 unidades o
          más en el período). Un producto puede vender muchísimo y dejarte poco:
          acá ves a cuáles les sacás más por peso vendido.
        </p>
      </div>

      {/* Ventas por empleado */}
      {porEmpleado.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Ventas por empleado</p>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Empleado</th>
                  <th className="px-4 py-2 text-right font-medium">Tickets</th>
                  <th className="px-4 py-2 text-right font-medium">Vendido</th>
                </tr>
              </thead>
              <tbody>
                {porEmpleado.map((e, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2">{e.empleado}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{e.tickets}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {pesos(Number(e.total))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Avisos a dueños */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Avisos</p>
        {eventos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin avisos.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {eventos.map((ev) => (
              <li
                key={ev.id}
                className={`flex items-center gap-3 rounded-lg border px-4 py-2 text-sm ${
                  ev.leido ? "opacity-50" : ""
                }`}
              >
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                  {EVENTO_LABEL[ev.tipo]}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {ev.ticket_nro ? `Ticket #${ev.ticket_nro}` : ""}
                  {ev.detalle ? ` — ${ev.detalle}` : ""}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {new Date(ev.creado_en).toLocaleString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "America/Argentina/Buenos_Aires",
                  })}
                </span>
                {!ev.leido ? (
                  <Button size="xs" variant="ghost" onClick={() => marcarLeido(ev.id)}>
                    Leído
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Metrica({
  label,
  valor,
  destacado,
  alerta,
}: {
  label: string;
  valor: string;
  destacado?: boolean;
  alerta?: boolean;
}) {
  return (
    <Card className="flex flex-col gap-1 p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={`font-bold tabular-nums ${destacado ? "text-2xl text-primary" : "text-xl"} ${
          alerta ? "text-destructive" : ""
        }`}
      >
        {valor}
      </span>
    </Card>
  );
}

function GastoTotal({ label, v }: { label: string; v?: number }) {
  return (
    <div className="flex flex-col rounded-lg border border-amber-200 bg-background px-3 py-2">
      <span className="text-xs text-amber-800">{label}</span>
      <span className="text-xl font-bold tabular-nums text-amber-900">
        {pesos(Number(v ?? 0))}
      </span>
    </div>
  );
}

function MedioFila({ label, v }: { label: string; v?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{pesos(Number(v ?? 0))}</span>
    </div>
  );
}
