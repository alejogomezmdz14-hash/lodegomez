"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { pesos } from "@/lib/formato";
import { imprimirTicket } from "@/lib/imprimir";
import { TicketCierre } from "./ticket-cierre";
import type { CierreHistorial, ResumenCaja } from "@/lib/types";

const fechaAR = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  });

export function CierresHistorial({ cierres }: { cierres: CierreHistorial[] }) {
  const [imprimible, setImprimible] = useState<{
    data: ResumenCaja;
    label: string;
  } | null>(null);

  function reimprimir(c: CierreHistorial) {
    const data: ResumenCaja = {
      caja_id: "",
      desde: null,
      hasta: c.hasta,
      cant_ventas: c.cant_ventas,
      total: c.total,
      total_efectivo: c.total_efectivo,
      total_qr: c.total_qr,
      total_tarjeta: c.total_tarjeta,
      total_transferencia: c.total_transferencia,
      egresos_efectivo: c.egresos_efectivo ?? 0,
      efectivo_contado: c.efectivo_contado,
      diferencia: c.diferencia,
    };
    setImprimible({ data, label: c.empleado_nombre ?? "Caja" });
    imprimirTicket();
  }

  if (cierres.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay cierres.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Fecha</th>
              <th className="px-4 py-2 font-medium">Empleado</th>
              <th className="px-4 py-2 text-right font-medium">Ventas</th>
              <th className="px-4 py-2 text-right font-medium">Total</th>
              <th className="px-4 py-2 text-right font-medium">Efectivo</th>
              <th className="px-4 py-2 text-right font-medium">Egresos</th>
              <th className="px-4 py-2 text-right font-medium">Diferencia</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {cierres.map((c) => {
              const dif = c.diferencia === null ? null : Number(c.diferencia);
              return (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-4 py-2 text-muted-foreground">{fechaAR(c.creado_en)}</td>
                  <td className="px-4 py-2">{c.empleado_nombre ?? "—"}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{c.cant_ventas}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pesos(Number(c.total))}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{pesos(Number(c.total_efectivo))}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {Number(c.egresos_efectivo ?? 0) > 0 ? `− ${pesos(Number(c.egresos_efectivo))}` : "—"}
                  </td>
                  <td
                    className={`px-4 py-2 text-right tabular-nums ${
                      dif === null ? "text-muted-foreground" : dif !== 0 ? "text-destructive" : ""
                    }`}
                  >
                    {dif === null ? "—" : pesos(dif)}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => reimprimir(c)}
                      title="Reimprimir este cierre"
                    >
                      <Printer className="h-4 w-4" /> Imprimir
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {typeof document !== "undefined" && imprimible
        ? createPortal(
            <TicketCierre data={imprimible.data} label={imprimible.label} />,
            document.body,
          )
        : null}
    </>
  );
}
