import { createClient } from "@/lib/supabase/server";
import { VentasCliente } from "./ventas-cliente";
import type { VentaListado } from "@/lib/types";

export default async function VentasPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ventas")
    .select("id,ticket_nro,creada_en,medio_pago,total,estado")
    .order("creada_en", { ascending: false })
    .limit(50);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ventas</h1>
        <p className="text-sm text-muted-foreground">
          Últimas ventas del turno. Anular avisa a los dueños y queda registrado.
        </p>
      </div>
      <VentasCliente ventasIniciales={(data as VentaListado[] | null) ?? []} />
    </div>
  );
}
