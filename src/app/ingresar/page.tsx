import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/auth";
import { Marca } from "@/components/marca";
import { LoginForm } from "./login-form";

export default async function IngresarPage({
  searchParams,
}: {
  searchParams: Promise<{ sinAcceso?: string }>;
}) {
  const usuario = await getUsuarioActual();
  if (usuario) redirect("/"); // ya logueado → rutea por sesión

  const { sinAcceso } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-12">
      <div className="flex flex-col items-center gap-2 text-center">
        <Marca priority className="h-44 w-auto" />
        <h1 className="text-xl font-semibold tracking-tight">Ingresá al sistema</h1>
      </div>

      {sinAcceso ? (
        <p className="rounded-lg bg-amber-100 px-4 py-3 text-center text-sm text-amber-900">
          Tu usuario no tiene acceso a esa sección.
        </p>
      ) : null}

      <LoginForm />
    </main>
  );
}
