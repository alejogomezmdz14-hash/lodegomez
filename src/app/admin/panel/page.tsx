import { requireAdmin } from "@/lib/auth";
import { PanelCliente } from "./panel-cliente";

export default async function PanelPage() {
  await requireAdmin(); // defensa en profundidad (además del middleware + layout)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Panel</h1>
        <p className="text-sm text-muted-foreground">
          Ventas, medios de pago, productos y avisos a los dueños.
        </p>
      </div>
      <PanelCliente />
    </div>
  );
}
