"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cerrarCaja, resumenCajaActual } from "@/lib/actions/caja";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { pesos, parseNumeroAR } from "@/lib/formato";
import { useTurno, turnoLabel, TURNOS } from "@/lib/turno";
import { SelectorTurno } from "@/components/selector-turno";
import type { ResumenCaja } from "@/lib/types";

export function CierreCliente({ esAdmin = false }: { esAdmin?: boolean }) {
  const { turno, elegir, limpiar, listo } = useTurno();

  // Admin: ve y puede cerrar las dos cajas (mañana y tarde). Sin gate.
  if (esAdmin) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Ves las dos cajas. Podés cerrar cualquiera.
        </p>
        <div className="flex flex-col gap-6 lg:flex-row">
          {TURNOS.map((t) => (
            <CierreTurno key={t.valor} caja={t.valor} label={t.label} />
          ))}
        </div>
      </div>
    );
  }

  // Empleado: elige turno sí o sí y cierra el suyo.
  if (listo && !turno) {
    return <SelectorTurno onElegir={elegir} />;
  }
  if (!turno) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }
  return (
    <CierreTurno
      caja={turno}
      label={turnoLabel(turno)}
      onClosed={limpiar}
      onCambiar={limpiar}
    />
  );
}

function CierreTurno({
  caja,
  label,
  onClosed,
  onCambiar,
}: {
  caja: string;
  label: string;
  onClosed?: () => void;
  onCambiar?: () => void;
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
    resumenCajaActual(caja).then((r) => {
      if (!cancelado) setResumen(r);
    });
    return () => {
      cancelado = true;
    };
  }, [caja, recarga]);

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
      const res = await cerrarCaja(val, caja);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const d = res.resumen.diferencia;
      toast.success(
        d == null
          ? `${label} cerrado`
          : `${label} cerrado — diferencia ${pesos(Number(d))}`,
      );
      setContado("");
      onClosed?.();
      setRecarga((x) => x + 1);
      router.refresh();
    });
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium">
          {label}
        </span>
        {onCambiar ? (
          <button
            type="button"
            onClick={onCambiar}
            className="text-xs font-medium text-primary hover:underline"
          >
            Cambiar turno
          </button>
        ) : null}
      </div>

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
                  ["QR", resumen.total_qr],
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
            {pending ? "Cerrando…" : `Cerrar caja — ${label}`}
          </Button>
        </>
      )}
    </div>
  );
}
