import { createClient } from "@/lib/supabase/server";
import { VentasCliente } from "./ventas-cliente";
import type { VentaListado } from "@/lib/types";

export default async function VentasPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("listar_ventas", { p_limite: 50 });

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ventas</h1>
        <p className="text-sm text-muted-foreground">
          Tocá un ticket para ver sus productos. Anular avisa a los dueños y queda registrado.
        </p>
      </div>
      <VentasCliente ventasIniciales={(data as VentaListado[] | null) ?? []} />
    </div>
  );
}
