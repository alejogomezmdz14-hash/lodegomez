"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { registrarEgreso, borrarEgreso, listarEgresos } from "@/lib/actions/egresos";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { pesos, parseNumeroAR } from "@/lib/formato";
import type { Egreso, MedioPago, TipoEgreso } from "@/lib/types";
import { cn } from "@/lib/utils";

export function EgresosCliente({ inicial }: { inicial: Egreso[] }) {
  const router = useRouter();
  const [egresos, setEgresos] = useState<Egreso[]>(inicial);
  const [tipo, setTipo] = useState<TipoEgreso>("retiro");
  const [medio, setMedio] = useState<MedioPago>("efectivo");
  const [monto, setMonto] = useState("");
  const [detalle, setDetalle] = useState("");
  const [pending, startTransition] = useTransition();

  function registrar() {
    const m = parseNumeroAR(monto);
    if (m === null || m <= 0) {
      toast.error("Poné un monto válido");
      return;
    }
    startTransition(async () => {
      const res = await registrarEgreso({
        tipo,
        medio_pago: tipo === "retiro" ? "efectivo" : medio,
        monto: m,
        detalle: detalle.trim() || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(tipo === "retiro" ? "Retiro registrado" : "Pago registrado");
      setMonto("");
      setDetalle("");
      setEgresos(await listarEgresos(50));
      router.refresh();
    });
  }

  function borrar(id: string) {
    startTransition(async () => {
      const res = await borrarEgreso(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setEgresos((prev) => prev.filter((e) => e.id !== id));
      toast.success("Egreso borrado");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Formulario */}
      <div className="flex w-full max-w-md flex-col gap-3 rounded-xl border p-4">
        <div className="grid grid-cols-2 gap-2">
          <TipoBtn activo={tipo === "retiro"} onClick={() => setTipo("retiro")}>
            Retiro de caja
          </TipoBtn>
          <TipoBtn
            activo={tipo === "pago_proveedor"}
            onClick={() => setTipo("pago_proveedor")}
          >
            Pago a proveedor
          </TipoBtn>
        </div>

        {tipo === "pago_proveedor" ? (
          <div className="grid grid-cols-2 gap-2">
            <MedioBtn activo={medio === "efectivo"} onClick={() => setMedio("efectivo")}>
              Efectivo
            </MedioBtn>
            <MedioBtn
              activo={medio === "transferencia"}
              onClick={() => setMedio("transferencia")}
            >
              Transferencia
            </MedioBtn>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            El retiro de caja siempre es en efectivo.
          </p>
        )}

        <label className="flex flex-col gap-1 text-sm">
          Monto
          <Input
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            inputMode="decimal"
            placeholder="0,00"
            className="h-11 text-lg"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          {tipo === "retiro" ? "Motivo (opcional)" : "Proveedor / detalle"}
          <Input
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            placeholder={tipo === "retiro" ? "Ej: para el banco" : "Ej: Coca-Cola"}
            className="h-11"
          />
        </label>

        <Button onClick={registrar} disabled={pending} size="lg">
          {pending ? "Guardando…" : "Registrar egreso"}
        </Button>
      </div>

      {/* Lista */}
      <div className="min-w-0 flex-1">
        <p className="mb-2 text-sm font-medium">Últimos egresos</p>
        {egresos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay egresos.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-xl border">
            {egresos.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    e.tipo === "retiro"
                      ? "bg-amber-100 text-amber-800"
                      : "bg-sky-100 text-sky-800",
                  )}
                >
                  {e.tipo === "retiro" ? "Retiro" : "Proveedor"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {e.detalle || (e.tipo === "retiro" ? "Retiro de caja" : "Pago a proveedor")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.medio_pago === "efectivo" ? "Efectivo" : "Transferencia"} ·{" "}
                    {e.empleado_nombre ?? "—"} ·{" "}
                    {new Date(e.creada_en).toLocaleString("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                      timeZone: "America/Argentina/Buenos_Aires",
                    })}
                    {e.cierre_id ? " · cerrado" : ""}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-destructive">
                  − {pesos(Number(e.monto))}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => borrar(e.id)}
                  disabled={pending}
                  aria-label="Borrar egreso"
                >
                  <Trash2 className="text-destructive" />
                </Button>
              </li>
            ))}
          </ul>
        )}
        </div>
      </div>
    </div>
  );
}

function TipoBtn({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border-2 px-3 py-3 text-sm font-semibold transition-colors",
        activo
          ? "border-primary bg-primary text-primary-foreground shadow-sm"
          : "border-border bg-background hover:border-primary/50 hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}

function MedioBtn({
  activo,
  onClick,
  children,
}: {
  activo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border-2 px-3 py-2 text-sm font-medium transition-colors",
        activo
          ? "border-primary bg-accent"
          : "border-border bg-background hover:bg-accent",
      )}
    >
      {children}
    </button>
  );
}
