import { createClient } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import { rangoDia } from "@/lib/fecha";
import { FiltroDia } from "@/components/filtro-dia";
import { CierreCliente } from "./cierre-cliente";
import { pesos } from "@/lib/formato";
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
        {cierres.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay cierres.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-left text-sm">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Fecha</th>
                  <th className="px-4 py-2 font-medium">Empleado</th>
                  <th className="px-4 py-2 text-right font-medium">Ventas</th>
                  <th className="px-4 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-right font-medium">Efectivo</th>
                  <th className="px-4 py-2 text-right font-medium">Egresos</th>
                  <th className="px-4 py-2 text-right font-medium">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {cierres.map((c) => {
                  const dif = c.diferencia === null ? null : Number(c.diferencia);
                  return (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="px-4 py-2 text-muted-foreground">
                        {new Date(c.creado_en).toLocaleString("es-AR", {
                          day: "2-digit",
                          month: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-2">{c.empleado_nombre ?? "—"}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{c.cant_ventas}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{pesos(Number(c.total))}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{pesos(Number(c.total_efectivo))}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                        {Number(c.egresos_efectivo ?? 0) > 0 ? `− ${pesos(Number(c.egresos_efectivo))}` : "—"}
                      </td>
                      <td
                        className={`px-4 py-2 text-right tabular-nums ${
                          dif === null ? "text-muted-foreground" : dif !== 0 ? "text-destructive" : ""
                        }`}
                      >
                        {dif === null ? "—" : pesos(dif)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
