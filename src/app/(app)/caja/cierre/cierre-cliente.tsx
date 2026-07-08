"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cerrarCaja } from "@/lib/actions/caja";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { pesos } from "@/lib/formato";
import type { ResumenCaja } from "@/lib/types";

export function CierreCliente({ resumen }: { resumen: ResumenCaja | null }) {
  const router = useRouter();
  const [contado, setContado] = useState("");
  const [pending, startTransition] = useTransition();

  if (!resumen) {
    return (
      <p className="text-sm text-muted-foreground">
        No se pudo cargar el resumen del turno.
      </p>
    );
  }

  const efectivoSistema = Number(resumen.total_efectivo);
  const contadoNum = Number(contado.replace(",", "."));
  const dif =
    contado.trim() !== "" && Number.isFinite(contadoNum)
      ? contadoNum - efectivoSistema
      : null;

  function cerrar() {
    const val = contado.trim() === "" ? null : Number(contado.replace(",", "."));
    if (val !== null && (!Number.isFinite(val) || val < 0)) {
      toast.error("Efectivo contado inválido");
      return;
    }
    startTransition(async () => {
      const res = await cerrarCaja(val);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      const d = res.resumen.diferencia;
      toast.success(
        d == null
          ? "Caja cerrada"
          : `Caja cerrada — diferencia ${pesos(Number(d))}`,
      );
      setContado("");
      router.refresh();
    });
  }

  const filas = [
    ["Efectivo", resumen.total_efectivo],
    ["QR", resumen.total_qr],
    ["Tarjeta", resumen.total_tarjeta],
    ["Transferencia", resumen.total_transferencia],
  ] as const;

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div className="rounded-xl border p-4">
        <p className="mb-2 text-sm text-muted-foreground">
          {resumen.cant_ventas} venta(s) sin cerrar
        </p>
        <ul className="flex flex-col gap-1">
          {filas.map(([label, val]) => (
            <li key={label} className="flex justify-between text-sm">
              <span>{label}</span>
              <span className="tabular-nums">{pesos(Number(val))}</span>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex justify-between border-t pt-2 text-base font-semibold">
          <span>Total</span>
          <span className="tabular-nums">{pesos(Number(resumen.total))}</span>
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
          Diferencia vs efectivo del sistema: <strong>{pesos(dif)}</strong>
        </p>
      ) : null}

      <Button onClick={cerrar} disabled={pending} size="lg" className="max-w-xs">
        {pending ? "Cerrando…" : "Cerrar caja"}
      </Button>
    </div>
  );
}
