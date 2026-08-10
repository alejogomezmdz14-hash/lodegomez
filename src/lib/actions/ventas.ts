"use server";

import { createClient } from "@/lib/supabase/server";
import type { ItemVenta, Pago, VentaTicket, EmpleadoSimple } from "@/lib/types";

export type ResultadoVenta =
  | { ok: true; venta: VentaTicket }
  | { ok: false; error: string };

// Registra una venta vía el RPC atómico registrar_venta. Acepta uno o varios
// pagos (pago dividido); la suma debe cubrir el total (lo valida el RPC).
export async function registrarVenta(
  pagos: Pago[],
  items: ItemVenta[],
  cajaId = "principal",
  personaId?: string | null, // a nombre de quién va el gasto (casa/local/empleado)
): Promise<ResultadoVenta> {
  if (!items || items.length === 0) {
    return { ok: false, error: "El carrito está vacío." };
  }
  if (!pagos || pagos.length === 0) {
    return { ok: false, error: "Falta el medio de pago." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("registrar_venta", {
    p_pagos: pagos,
    p_items: items,
    p_caja_id: cajaId,
    p_persona_id: personaId ?? null,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, venta: data as VentaTicket };
}

// Nombres de los usuarios, para el selector "¿quién fue?" de los gastos.
export async function listarEmpleados(): Promise<EmpleadoSimple[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("listar_empleados");
  return (data as EmpleadoSimple[] | null) ?? [];
}

export type ResultadoAnular =
  | { ok: true; ticket_nro: number }
  | { ok: false; error: string };

// Anula una venta activa (reintegra stock + avisa a los dueños) vía RPC.
export async function anularVenta(
  ventaId: string,
  motivo: string,
): Promise<ResultadoAnular> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("anular_venta", {
    p_venta_id: ventaId,
    p_motivo: motivo.trim() || null,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ticket_nro: (data as { ticket_nro: number }).ticket_nro };
}
