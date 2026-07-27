import { createClient } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import { rangoDia } from "@/lib/fecha";
import { FiltroDia } from "@/components/filtro-dia";
import { CierreCliente } from "./cierre-cliente";
import { CierresHistorial } from "./cierres-historial";
import type { CierreHistorial } from "@/lib/types";

export default async function CierrePage({
  searchParams,
}: {
  searchParams: Promise<{ dia?: string }>;
}) {
  const { dia } = await searchParams;
  const u = await getUsuarioActual();
  const supabase = await createClient();
  const { data } = await supabase.rpc("listar_cierres", {
    p_limite: dia ? 500 : 20,
    ...rangoDia(dia),
  });
  const cierres = (data as CierreHistorial[] | null) ?? [];

  return (
    <div className="flex flex-col gap-8 p-6 print:hidden">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Cierre de caja</h1>
          <p className="text-sm text-muted-foreground">
            Tu caja: lo que entró desde tu último cierre, por medio de pago.
          </p>
        </div>
        <CierreCliente esAdmin={u?.rol === "admin"} />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Cierres anteriores</p>
          <FiltroDia />
        </div>
        <CierresHistorial cierres={cierres} />
      </section>
    </div>
  );
}
