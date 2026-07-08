"use server";

import { createClient } from "@/lib/supabase/server";
import type { ItemVenta, MedioPago, VentaTicket } from "@/lib/types";

export type ResultadoVenta =
  | { ok: true; venta: VentaTicket }
  | { ok: false; error: string };

// Registra una venta vía el RPC atómico registrar_venta (calcula precios desde
// el catálogo, inserta venta + items y descuenta stock en una transacción).
export async function registrarVenta(
  medioPago: MedioPago,
  items: ItemVenta[],
): Promise<ResultadoVenta> {
  if (!items || items.length === 0) {
    return { ok: false, error: "El carrito está vacío." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("registrar_venta", {
    p_medio_pago: medioPago,
    p_items: items,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, venta: data as VentaTicket };
}
