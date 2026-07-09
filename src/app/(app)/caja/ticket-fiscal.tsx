import { pesos, cantidadStr } from "@/lib/formato";
import { EMISOR } from "@/lib/afip/emisor";
import type { Comprobante, TicketItem } from "@/lib/types";

// Ticket fiscal 80mm (Factura A/B). Réplica del comprobante de Easy POS.
// Oculto en pantalla; visible solo al imprimir (mismas reglas que Ticket).
export function TicketFiscal({
  comprobante,
  items,
  qrSvg,
}: {
  comprobante: Comprobante | null;
  items: TicketItem[];
  qrSvg: string | null;
}) {
  if (!comprobante || comprobante.estado !== "emitido") return null;
  const c = comprobante;
  const nro = `${String(c.punto_venta).padStart(4, "0")}-${String(c.numero ?? 0).padStart(8, "0")}`;
  const cod = c.tipo === "A" ? "COD.01" : "COD.06";

  return (
    <div className="hidden print:block">
      <div className="mx-auto w-[72mm] px-1 py-2 text-[11px] leading-tight text-black">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-2xl font-black leading-none">{c.tipo}</span>
          <span className="text-[10px]">{cod}</span>
          <span className="mt-1 font-semibold">FACTURA ELECTRÓNICA</span>
          <span>Nº {nro}</span>
        </div>

        <div className="my-2 border-t border-dashed border-black" />
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-bold">{EMISOR.razonSocial}</span>
          <span>{EMISOR.domicilio}</span>
          <span>{EMISOR.localidad}</span>
          <span>{EMISOR.telefono}</span>
          <span className="mt-1">{EMISOR.condicion}</span>
          <span>CUIT {EMISOR.cuit}</span>
          <span>Ing. Brutos {EMISOR.ingresosBrutos}</span>
          <span>In. Act. {EMISOR.inicioActividades}</span>
        </div>

        <div className="my-2 border-t border-dashed border-black" />
        <span>
          Cliente:{" "}
          {c.tipo === "B" ? "C. FINAL" : `${c.cliente_nombre ?? ""} (CUIT ${c.doc_nro})`}
        </span>

        <div className="my-2 border-t border-dashed border-black" />
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left">
              <th>Cant.</th>
              <th>Detalle</th>
              <th className="text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="align-top tabular-nums">
                  {it.es_pesable ? `${cantidadStr(it.cantidad)}` : it.cantidad.toFixed(3)}
                </td>
                <td className="align-top">{it.descripcion}</td>
                <td className="text-right align-top tabular-nums">{pesos(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="my-2 border-t border-dashed border-black" />
        <div className="flex justify-between text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{pesos(c.total)}</span>
        </div>

        {c.tipo === "B" ? (
          <div className="mt-2 flex flex-col gap-0.5 text-[10px]">
            <span>Régimen de Transparencia Fiscal a Consumidor Final (Ley 27.742)</span>
            <div className="flex justify-between">
              <span>IVA Contenido $</span>
              <span className="tabular-nums">{pesos(c.iva)}</span>
            </div>
            <div className="flex justify-between">
              <span>Otros Impuestos Nacionales Indirectos $</span>
              <span className="tabular-nums">{pesos(0)}</span>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-0.5 text-[10px]">
            <div className="flex justify-between">
              <span>Neto Gravado $</span>
              <span className="tabular-nums">{pesos(c.neto)}</span>
            </div>
            <div className="flex justify-between">
              <span>IVA $</span>
              <span className="tabular-nums">{pesos(c.iva)}</span>
            </div>
          </div>
        )}

        <div className="my-2 border-t border-dashed border-black" />
        <div className="flex flex-col gap-0.5">
          <span>CAE {c.cae}</span>
          <span>Vto. {c.cae_vto}</span>
        </div>
        {qrSvg ? (
          <div
            className="mx-auto mt-2 w-[35mm]"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : null}
        <p className="mt-2 text-center text-[10px]">¡Gracias por tu compra!</p>
      </div>
    </div>
  );
}
