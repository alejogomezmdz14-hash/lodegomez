import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/auth";
import { cerrarSesion } from "@/lib/actions/auth";
import { LoginForm } from "./login-form";

export default async function IngresarPage({
  searchParams,
}: {
  searchParams: Promise<{ sinAcceso?: string }>;
}) {
  const usuario = await getUsuarioActual();
  if (usuario?.rol === "admin") redirect("/admin/empleados");

  const { sinAcceso } = await searchParams;
  const logueadoSinAcceso = Boolean(usuario); // hay sesión pero no es admin

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <div className="flex flex-col gap-1 text-center">
        <span className="text-sm font-medium uppercase tracking-widest text-zinc-500">
          Lo De Gómez
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Ingresá al sistema</h1>
      </div>

      {sinAcceso || logueadoSinAcceso ? (
        <p className="rounded-lg bg-amber-100 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          Tu usuario no tiene acceso al panel de administración.
        </p>
      ) : null}

      {logueadoSinAcceso ? (
        <form action={cerrarSesion}>
          <button className="w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-base font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">
            Cerrar sesión
          </button>
        </form>
      ) : (
        <LoginForm />
      )}
    </main>
  );
}
