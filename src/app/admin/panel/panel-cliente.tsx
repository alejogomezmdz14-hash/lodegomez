"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { pesos, cantidadStr } from "@/lib/formato";
import type {
  MetricasPeriodo,
  RankingItem,
  EventoDueno,
  TipoEvento,
} from "@/lib/types";

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

export function PanelCliente() {
  const [supabase] = useState(() => createClient());
  const [preset, setPreset] = useState<Preset>("hoy");
  const [metricas, setMetricas] = useState<MetricasPeriodo | null>(null);
  const [ranking, setRanking] = useState<RankingItem[]>([]);
  const [eventos, setEventos] = useState<EventoDueno[]>([]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let cancelado = false;
    const { desde, hasta } = rango(preset);
    (async () => {
      setCargando(true);
      const [m, r, e] = await Promise.all([
        supabase.rpc("metricas_periodo", { p_desde: desde, p_hasta: hasta }),
        supabase.rpc("ranking_productos", {
          p_desde: desde,
          p_hasta: hasta,
          p_limite: 10,
        }),
        supabase
          .from("eventos_duenos")
          .select("*")
          .order("creado_en", { ascending: false })
          .limit(30),
      ]);
      if (cancelado) return;
      setMetricas((m.data as MetricasPeriodo | null) ?? null);
      setRanking((r.data as RankingItem[] | null) ?? []);
      setEventos((e.data as EventoDueno[] | null) ?? []);
      setCargando(false);
    })();
    return () => {
      cancelado = true;
    };
  }, [preset, supabase]);

  async function marcarLeido(id: string) {
    setEventos((prev) =>
      prev.map((ev) => (ev.id === id ? { ...ev, leido: true } : ev)),
    );
    await supabase.from("eventos_duenos").update({ leido: true }).eq("id", id);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Rango */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.id}
            variant={preset === p.id ? "default" : "outline"}
            size="sm"
            onClick={() => setPreset(p.id)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metrica label="Vendido" valor={pesos(Number(metricas?.total ?? 0))} destacado />
        <Metrica label="Tickets" valor={String(metricas?.cant_tickets ?? 0)} />
        <Metrica label="Margen estimado" valor={pesos(Number(metricas?.margen ?? 0))} />
        <Metrica
          label="Anulaciones"
          valor={String(metricas?.anulaciones ?? 0)}
          alerta={(metricas?.anulaciones ?? 0) > 0}
        />
      </div>

      {/* Medios de pago */}
      <Card className="flex flex-col gap-2 p-4">
        <p className="text-sm font-medium">Por medio de pago</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
          <MedioFila label="Efectivo" v={metricas?.efectivo} />
          <MedioFila label="QR" v={metricas?.qr} />
          <MedioFila label="Tarjeta" v={metricas?.tarjeta} />
          <MedioFila label="Transferencia" v={metricas?.transferencia} />
        </div>
      </Card>

      {/* Ranking */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Productos más vendidos</p>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Producto</th>
                <th className="px-4 py-2 text-right font-medium">Cantidad</th>
                <th className="px-4 py-2 text-right font-medium">Facturado</th>
                <th className="px-4 py-2 text-right font-medium">Margen</th>
              </tr>
            </thead>
            <tbody>
              {ranking.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    {cargando ? "Cargando…" : "Sin ventas en el período."}
                  </td>
                </tr>
              ) : (
                ranking.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2">{r.descripcion || r.codigo}</td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {cantidadStr(Number(r.unidades))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {pesos(Number(r.facturado))}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                      {pesos(Number(r.margen))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

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

function MedioFila({ label, v }: { label: string; v?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular-nums">{pesos(Number(v ?? 0))}</span>
    </div>
  );
}
