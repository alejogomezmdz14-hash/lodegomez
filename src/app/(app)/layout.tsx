import Link from "next/link";
import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/auth";
import { cerrarSesion } from "@/lib/actions/auth";
import { Marca } from "@/components/marca";
import { Button } from "@/components/ui/button";

// Shell de la app operativa (empleado + admin). Defensa en profundidad:
// el middleware ya gatea, y acá también.
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const u = await getUsuarioActual();
  if (!u) redirect("/ingresar");
  const esAdmin = u.rol === "admin";

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 border-b px-4 py-2 print:hidden">
        <Link href="/caja" className="shrink-0" aria-label="Inicio">
          <Marca className="h-9 w-auto" priority />
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto">
          <NavLink href="/caja">Cobrar</NavLink>
          <NavLink href="/caja/ventas">Ventas</NavLink>
          <NavLink href="/caja/cierre">Cierre</NavLink>
          <NavLink href="/egresos">Egresos</NavLink>
          <NavLink href="/productos">Productos</NavLink>
          <NavLink href="/reposicion">Reposición</NavLink>
          {esAdmin ? <NavLink href="/admin/panel">Panel</NavLink> : null}
          {esAdmin ? <NavLink href="/admin/empleados">Empleados</NavLink> : null}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-sm text-muted-foreground sm:inline">
            {u.nombre ?? u.rol}
          </span>
          <form action={cerrarSesion}>
            <Button variant="ghost" size="sm" type="submit">
              Salir
            </Button>
          </form>
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {children}
      </main>
    </div>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground/80 hover:bg-accent hover:text-accent-foreground"
    >
      {children}
    </Link>
  );
}
