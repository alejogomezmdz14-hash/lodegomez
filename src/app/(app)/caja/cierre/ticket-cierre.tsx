"use client";

import { pesos } from "@/lib/formato";
import type { ResumenCaja } from "@/lib/types";

// Comprobante de cierre imprimible (80mm). Se muestra solo al imprimir.
export function TicketCierre({
  data,
  label,
}: {
  data: ResumenCaja | null;
  label: string;
}) {
  if (!data) return null;
  const egr = Number(data.egresos_efectivo ?? 0);
  const esperado =
    data.efectivo_esperado ?? Number(data.total_efectivo) - egr;
  const contado = data.efectivo_contado;
  const dif = data.diferencia;
  const fila = (l: React.ReactNode, v: React.ReactNode) => (
    <div className="flex justify-between">
      <span>{l}</span>
      <span>{v}</span>
    </div>
  );

  return (
    <div className="hidden print:block" data-print-cierre>
      <div className="mx-auto w-[72mm] p-1 font-mono text-[12px] leading-tight text-black">
        <div className="text-center">
          <p className="text-base font-bold">Lo De Gómez</p>
          <p className="font-semibold">CIERRE DE CAJA</p>
          <p className="uppercase">{label}</p>
          <p>
            {new Date(data.hasta).toLocaleString("es-AR", {
              day: "2-digit",
              month: "2-digit",
              year: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        <div className="my-1 border-t border-dashed border-black" />
        {fila("Ventas", String(data.cant_ventas))}
        <div className="my-1 border-t border-dashed border-black" />
        {fila("Efectivo", pesos(Number(data.total_efectivo)))}
        {fila("QR", pesos(Number(data.total_qr)))}
        {fila("Tarjeta", pesos(Number(data.total_tarjeta)))}
        {fila("Transferencia", pesos(Number(data.total_transferencia)))}
        <div className="my-1 border-t border-dashed border-black" />
        {fila(<b>Total vendido</b>, <b>{pesos(Number(data.total))}</b>)}
        {egr > 0 ? fila("Egresos efectivo", `- ${pesos(egr)}`) : null}
        {fila(<b>Efectivo esperado</b>, <b>{pesos(esperado)}</b>)}
        {contado != null ? fila("Efectivo contado", pesos(Number(contado))) : null}
        {dif != null ? fila(<b>Diferencia</b>, <b>{pesos(Number(dif))}</b>) : null}
        <div className="my-1 border-t border-dashed border-black" />
        <p className="text-center text-[11px]">Comprobante interno — no fiscal</p>
      </div>
    </div>
  );
}
