"use server";

import { createClient } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import type { ResumenCaja, CajaAbierta } from "@/lib/types";

export type ResultadoCierre =
  | { ok: true; resumen: ResumenCaja }
  | { ok: false; error: string };

// Resumen de la caja abierta de un empleado (default: uno mismo; el admin puede
// pasar el id de otro empleado).
export async function resumenCajaActual(
  empleadoId?: string,
): Promise<ResumenCaja | null> {
  const u = await getUsuarioActual();
  if (!u) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resumen_caja_actual", {
    p_empleado_id: empleadoId ?? null,
  });
  if (error) return null;
  return data as ResumenCaja;
}

// Cierra la caja de un empleado (default: la propia).
export async function cerrarCaja(
  efectivoContado: number | null,
  empleadoId?: string,
): Promise<ResultadoCierre> {
  const u = await getUsuarioActual();
  if (!u) return { ok: false, error: "No autorizado" };
  if (
    efectivoContado !== null &&
    (!Number.isFinite(efectivoContado) || efectivoContado < 0)
  ) {
    return { ok: false, error: "El efectivo contado no puede ser negativo." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cerrar_caja", {
    p_empleado_id: empleadoId ?? null,
    p_efectivo_contado: efectivoContado,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, resumen: data as ResumenCaja };
}

// Cajas abiertas por empleado (solo admin).
export async function cajasAbiertas(): Promise<CajaAbierta[]> {
  const u = await getUsuarioActual();
  if (!u) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("cajas_abiertas");
  return (data as CajaAbierta[] | null) ?? [];
}
