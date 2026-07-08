import { resumenCajaActual } from "@/lib/actions/caja";
import { CierreCliente } from "./cierre-cliente";

export default async function CierrePage() {
  const resumen = await resumenCajaActual();
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Cierre de caja</h1>
        <p className="text-sm text-muted-foreground">
          Cuánto entró en el turno por cada medio de pago.
        </p>
      </div>
      <CierreCliente resumen={resumen} />
    </div>
  );
}
