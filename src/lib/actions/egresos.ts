"use server";

import { createClient } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import type { Egreso, MedioPago, TipoEgreso } from "@/lib/types";

export type ResultadoEgreso =
  | { ok: true }
  | { ok: false; error: string };

// Registra un retiro de caja o un pago a proveedor. Cualquier usuario provisionado.
// El efectivo resta del efectivo esperado en el cierre (lo hace la RPC cerrar_caja).
export async function registrarEgreso(input: {
  tipo: TipoEgreso;
  medio_pago: MedioPago;
  monto: number;
  detalle?: string;
}): Promise<ResultadoEgreso> {
  const u = await getUsuarioActual();
  if (!u) return { ok: false, error: "No autorizado" };
  if (input.tipo !== "retiro" && input.tipo !== "pago_proveedor") {
    return { ok: false, error: "Tipo de egreso inválido." };
  }
  if (!Number.isFinite(input.monto) || input.monto <= 0) {
    return { ok: false, error: "Poné un monto válido." };
  }
  // El retiro de caja siempre es efectivo.
  const medio = input.tipo === "retiro" ? "efectivo" : input.medio_pago;

  const supabase = await createClient();
  const { error } = await supabase.from("movimientos_caja").insert({
    tipo: input.tipo,
    medio_pago: medio,
    monto: input.monto,
    detalle: input.detalle?.trim() || null,
    caja_id: "principal",
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Lista los egresos recientes (con quién lo registró).
export async function listarEgresos(limite = 50): Promise<Egreso[]> {
  const u = await getUsuarioActual();
  if (!u) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("listar_egresos", { p_limite: limite });
  return (data as Egreso[] | null) ?? [];
}

// Borra un egreso (admin cualquiera; empleado solo lo suyo si el turno no cerró).
export async function borrarEgreso(id: string): Promise<ResultadoEgreso> {
  const u = await getUsuarioActual();
  if (!u) return { ok: false, error: "No autorizado" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("movimientos_caja")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "No se pudo borrar (sin permiso o turno ya cerrado)." };
  return { ok: true };
}
