import { getUsuarioActual } from "@/lib/auth";
import { listarEgresos } from "@/lib/actions/egresos";
import { cajasAbiertas } from "@/lib/actions/caja";
import { EgresosCliente } from "./egresos-cliente";

export default async function EgresosPage() {
  const u = await getUsuarioActual();
  const esAdmin = u?.rol === "admin";
  const [egresos, cajas] = await Promise.all([
    listarEgresos(50),
    esAdmin ? cajasAbiertas() : Promise.resolve([]),
  ]);
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Egresos</h1>
        <p className="text-sm text-muted-foreground">
          Retiros de caja y pagos a proveedores. El efectivo resta de tu cierre de caja.
        </p>
      </div>
      <EgresosCliente inicial={egresos} esAdmin={esAdmin} cajas={cajas} />
    </div>
  );
}
