import Link from "next/link";
import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/auth";
import { cerrarSesion } from "@/lib/actions/auth";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Defensa en profundidad: el middleware ya gatea, y acá también.
  const usuario = await getUsuarioActual();
  if (usuario?.rol !== "admin") redirect("/ingresar?sinAcceso=1");

  return (
    <div className="flex min-h-full flex-1">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-zinc-200 p-4 dark:border-zinc-800 sm:flex">
        <span className="mb-6 px-3 text-sm font-semibold uppercase tracking-widest text-zinc-500">
          Lo De Gómez
        </span>
        <nav className="flex flex-col gap-1">
          <Link
            href="/admin/panel"
            className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Panel
          </Link>
          <Link
            href="/admin/empleados"
            className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Empleados
          </Link>
          <Link
            href="/admin/clientes"
            className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            Clientes
          </Link>
          <Link
            href="/caja"
            className="rounded-lg px-3 py-2 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900"
          >
            ← Volver a cobrar
          </Link>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            {usuario.nombre ?? "Admin"}
          </span>
          <form action={cerrarSesion}>
            <button className="rounded-lg px-3 py-1.5 text-sm font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900">
              Cerrar sesión
            </button>
          </form>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
