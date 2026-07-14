import { getUsuarioActual } from "@/lib/auth";
import { listarEgresos } from "@/lib/actions/egresos";
import { EgresosCliente } from "./egresos-cliente";

export default async function EgresosPage() {
  const u = await getUsuarioActual();
  const egresos = await listarEgresos(50);
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Egresos</h1>
        <p className="text-sm text-muted-foreground">
          Retiros de caja y pagos a proveedores. El efectivo resta del cierre del turno.
        </p>
      </div>
      <EgresosCliente inicial={egresos} esAdmin={u?.rol === "admin"} />
    </div>
  );
}
