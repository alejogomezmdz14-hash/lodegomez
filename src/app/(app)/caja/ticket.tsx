import { pesos, cantidadStr } from "@/lib/formato";
import { MEDIOS_PAGO, type VentaTicket } from "@/lib/types";

// Ticket 80mm imprimible (no fiscal). Oculto en pantalla; visible solo al
// imprimir (@media print + @page 80mm en globals.css).
export function Ticket({ venta }: { venta: VentaTicket | null }) {
  if (!venta) return null;

  const fecha = new Date(venta.creada_en);
  const medio =
    MEDIOS_PAGO.find((m) => m.valor === venta.medio_pago)?.label ??
    venta.medio_pago;

  return (
    <div className="hidden print:block">
      <div className="mx-auto w-[72mm] px-1 py-2 text-[11px] leading-tight text-black">
        <div className="flex flex-col items-center gap-1">
          {/* Logo del ticket. w-[38mm] = tamaño legible en 80mm; ajustable. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/logo.png"
            alt="Lo De Gómez"
            className="h-auto w-[38mm] object-contain"
          />
          <p className="text-center text-[10px]">
            Ticket no válido como factura
          </p>
        </div>

        <div className="my-2 border-t border-dashed border-black" />
        <div className="flex justify-between">
          <span>Ticket #{venta.ticket_nro}</span>
          <span>{fecha.toLocaleString("es-AR")}</span>
        </div>
        <div className="my-2 border-t border-dashed border-black" />

        <table className="w-full border-collapse">
          <tbody>
            {venta.items.map((it, i) => (
              <tr key={i}>
                <td className="py-0.5 align-top">
                  {it.descripcion}
                  <br />
                  <span className="text-[10px]">
                    {it.es_pesable
                      ? `${cantidadStr(it.cantidad)} kg`
                      : `${it.cantidad} u`}{" "}
                    × {pesos(it.precio_unit)}
                  </span>
                </td>
                <td className="py-0.5 text-right align-top tabular-nums">
                  {pesos(it.subtotal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="my-2 border-t border-dashed border-black" />
        <div className="flex justify-between text-base font-bold">
          <span>TOTAL</span>
          <span className="tabular-nums">{pesos(venta.total)}</span>
        </div>
        <p className="mt-1 text-right text-[10px]">Pago: {medio}</p>
        <p className="mt-3 text-center text-[10px]">¡Gracias por tu compra!</p>
      </div>
    </div>
  );
}
