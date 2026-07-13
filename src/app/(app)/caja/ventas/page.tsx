import { createClient } from "@/lib/supabase/server";
import { estadosFiscales } from "@/lib/actions/comprobantes";
import { rangoDia } from "@/lib/fecha";
import { FiltroDia } from "@/components/filtro-dia";
import { VentasCliente } from "./ventas-cliente";
import type { VentaListado } from "@/lib/types";

export default async function VentasPage({
  searchParams,
}: {
  searchParams: Promise<{ dia?: string }>;
}) {
  const { dia } = await searchParams;
  const rango = rangoDia(dia);
  const supabase = await createClient();
  const { data } = await supabase.rpc("listar_ventas", {
    p_limite: dia ? 1000 : 50,
    ...rango,
  });
  const ventas = (data as VentaListado[] | null) ?? [];
  const fiscales = await estadosFiscales(ventas.map((v) => v.id));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Ventas</h1>
          <p className="text-sm text-muted-foreground">
            {dia
              ? "Ventas del día elegido."
              : "Tocá un ticket para ver sus productos. Anular avisa a los dueños y queda registrado."}
          </p>
        </div>
        <FiltroDia />
      </div>
      <VentasCliente ventasIniciales={ventas} fiscales={fiscales} />
    </div>
  );
}
