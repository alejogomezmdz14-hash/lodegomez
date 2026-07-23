"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Printer } from "lucide-react";
import {
  cerrarCaja,
  resumenCajaActual,
  cajasAbiertas,
} from "@/lib/actions/caja";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { pesos, parseNumeroAR } from "@/lib/formato";
import { imprimirTicket } from "@/lib/imprimir";
import { TicketCierre } from "./ticket-cierre";
import type { ResumenCaja, CajaAbierta } from "@/lib/types";

export function CierreCliente({ esAdmin = false }: { esAdmin?: boolean }) {
  const [imprimible, setImprimible] = useState<{
    data: ResumenCaja;
    label: string;
  } | null>(null);
  const [cajas, setCajas] = useState<CajaAbierta[] | null>(null);

  useEffect(() => {
    if (!esAdmin) return;
    cajasAbiertas().then(setCajas);
  }, [esAdmin]);

  function imprimir(data: ResumenCaja, label: string) {
    setImprimible({ data, label });
    imprimirTicket();
  }

  let contenido: React.ReactNode;
  if (esAdmin) {
    contenido =
      cajas === null ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : cajas.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ninguna caja abierta ahora mismo.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Cajas abiertas por empleado. Podés cerrar cualquiera.
          </p>
          <div className="flex flex-col gap-6 lg:flex-row lg:flex-wrap">
            {cajas.map((c) => (
              <CierreCaja
                key={c.empleado_id}
                empleadoId={c.empleado_id}
                label={c.nombre}
                onImprimir={imprimir}
              />
            ))}
          </div>
        </div>
      );
  } else {
    contenido = <CierreCaja label="Tu caja" onImprimir={imprimir} />;
  }

  return (
    <>
      {imprimible ? (
        <div className="mb-3 print:hidden">
          <Button
            variant="outline"
            size="sm"
            onClick={() => imprimir(imprimible.data, imprimible.label)}
          >
            <Printer className="h-4 w-4" /> Reimprimir último cierre
          </Button>
        </div>
      ) : null}
      {contenido}
      {typeof document !== "undefined" && imprimible
        ? createPortal(
            <TicketCierre data={imprimible.data} label={imprimible.label} />,
            document.body,
          )
        : null}
    </>
  );
}

function CierreCaja({
  empleadoId,
  label,
  onImprimir,
}: {
  empleadoId?: string;
  label: string;
  onImprimir: (data: ResumenCaja, label: string) => void;
}) {
  const router = useRouter();
  const [resumen, setResumen] = useState<ResumenCaja | null | undefined>(
    undefined,
  );
  const [contado, setContado] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelado = false;
    resumenCajaActual(empleadoId).then((r) => {
      if (!cancelado) setResumen(r);
    });
    return () => {
      cancelado = true;
    };
  }, [empleadoId, recarga]);

  const egresosEfec = Number(resumen?.egresos_efectivo ?? 0);
  const efectivoEsperado = resumen
    ? resumen.efectivo_esperado ?? Number(resumen.total_efectivo) - egresosEfec
    : 0;
  const contadoNum = parseNumeroAR(contado);
  const dif = contadoNum !== null ? contadoNum - efectivoEsperado : null;

  function cerrar() {
    const val = contado.trim() === "" ? null : parseNumeroAR(contado);
    if (contado.trim() !== "" && (val === null || val < 0)) {
      toast.error("Efectivo contado inválido");
      return;
    }
    startTransition(async () => {
      const res = await cerrarCaja(val, empleadoId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const d = res.resumen.diferencia;
      toast.success(
        d == null
          ? `${label}: caja cerrada`
          : `${label}: cerrada — diferencia ${pesos(Number(d))}`,
      );
      setContado("");
      onImprimir(res.resumen, label);
      setRecarga((x) => x + 1);
      router.refresh();
    });
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <span className="w-fit rounded-lg bg-accent px-3 py-1.5 text-sm font-medium">
        {label}
      </span>

      {resumen === undefined ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : !resumen ? (
        <p className="text-sm text-muted-foreground">
          No se pudo cargar el resumen.
        </p>
      ) : (
        <>
          <div className="rounded-xl border p-4">
            <p className="mb-2 text-sm text-muted-foreground">
              {resumen.cant_ventas} venta(s) sin cerrar
            </p>
            <ul className="flex flex-col gap-1">
              {(
                [
                  ["Efectivo", resumen.total_efectivo],
                  ["Tarjeta", resumen.total_tarjeta],
                  ["Transferencia", resumen.total_transferencia],
                ] as const
              ).map(([l, val]) => (
                <li key={l} className="flex justify-between text-sm">
                  <span>{l}</span>
                  <span className="tabular-nums">{pesos(Number(val))}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
              <span>Total</span>
              <span className="tabular-nums">{pesos(Number(resumen.total))}</span>
            </div>
            {egresosEfec > 0 ? (
              <div className="mt-2 flex justify-between border-t pt-2 text-sm text-destructive">
                <span>Egresos en efectivo (retiros + pagos)</span>
                <span className="tabular-nums">− {pesos(egresosEfec)}</span>
              </div>
            ) : null}
            <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
              <span>Efectivo esperado en caja</span>
              <span className="tabular-nums">{pesos(efectivoEsperado)}</span>
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">
              Efectivo contado en caja (opcional)
            </span>
            <Input
              value={contado}
              onChange={(e) => setContado(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              className="h-11 max-w-xs"
            />
          </label>
          {dif !== null ? (
            <p
              className={`text-sm ${
                dif === 0
                  ? "text-muted-foreground"
                  : dif > 0
                    ? "text-primary"
                    : "text-destructive"
              }`}
            >
              Diferencia vs efectivo esperado: <strong>{pesos(dif)}</strong>
            </p>
          ) : null}

          <Button
            onClick={cerrar}
            disabled={pending}
            size="lg"
            className="max-w-xs"
          >
            {pending ? "Cerrando…" : "Cerrar e imprimir"}
          </Button>
        </>
      )}
    </div>
  );
}
