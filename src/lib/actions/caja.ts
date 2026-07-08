"use server";

import { createClient } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import type { ResumenCaja } from "@/lib/types";

const CAJA = "principal"; // MVP: una sola caja

export type ResultadoCierre =
  | { ok: true; resumen: ResumenCaja }
  | { ok: false; error: string };

// Totales del turno abierto (solo lectura).
export async function resumenCajaActual(): Promise<ResumenCaja | null> {
  const u = await getUsuarioActual();
  if (!u) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resumen_caja_actual", {
    p_caja_id: CAJA,
  });
  if (error) return null;
  return data as ResumenCaja;
}

// Cierra el turno y devuelve el resumen (con diferencia si se contó el efectivo).
export async function cerrarCaja(
  efectivoContado: number | null,
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
    p_caja_id: CAJA,
    p_efectivo_contado: efectivoContado,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, resumen: data as ResumenCaja };
}
