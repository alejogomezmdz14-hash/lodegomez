"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { anularVenta } from "@/lib/actions/ventas";
import { Button } from "@/components/ui/button";
import { pesos } from "@/lib/formato";
import { MEDIOS_PAGO, type VentaListado } from "@/lib/types";

export function VentasCliente({
  ventasIniciales,
}: {
  ventasIniciales: VentaListado[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function anular(v: VentaListado) {
    const motivo = window.prompt(
      `Anular ticket #${v.ticket_nro} (${pesos(Number(v.total))}).\nMotivo:`,
    );
    if (motivo === null) return; // canceló
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

  if (ventasIniciales.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No hay ventas todavía.</p>
    );
  }

  const medioLabel = (m: string) =>
    MEDIOS_PAGO.find((x) => x.valor === m)?.label ?? m;

  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <thead className="border-b text-muted-foreground">
          <tr>
            <th className="px-4 py-3 font-medium">Ticket</th>
            <th className="px-4 py-3 font-medium">Hora</th>
            <th className="px-4 py-3 font-medium">Medio</th>
            <th className="px-4 py-3 text-right font-medium">Total</th>
            <th className="px-4 py-3 font-medium">Estado</th>
            <th className="px-4 py-3 text-right font-medium">Acción</th>
          </tr>
        </thead>
        <tbody>
          {ventasIniciales.map((v) => (
            <tr key={v.id} className="border-b last:border-0">
              <td className="px-4 py-3 tabular-nums">#{v.ticket_nro}</td>
              <td className="px-4 py-3 text-muted-foreground">
                {new Date(v.creada_en).toLocaleTimeString("es-AR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
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
                {v.estado === "activa" ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={pending}
                    onClick={() => anular(v)}
                  >
                    Anular
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
