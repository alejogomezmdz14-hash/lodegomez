import { getUsuarioActual } from "@/lib/auth";
import { listarUsuarios } from "@/lib/actions/usuarios";
import { EmpleadosCliente } from "./empleados-cliente";

export default async function EmpleadosPage() {
  const [usuarios, yo] = await Promise.all([
    listarUsuarios(),
    getUsuarioActual(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Empleados</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Gestioná quién entra al sistema y con qué permisos.
        </p>
      </div>
      <EmpleadosCliente usuarios={usuarios} miId={yo?.id ?? ""} />
    </div>
  );
}
