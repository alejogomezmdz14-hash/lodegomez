"use server";

import { createClient } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";

export type ResultadoGuardado =
  | { ok: true; precio_venta: number | null; stock: number }
  | { ok: false; error: string };

// Edita precio y/o stock de un producto. La RLS + el trigger productos_guard_update
// limitan al empleado a precio_venta/stock; el trigger de auditoría registra el
// cambio. Devuelve el valor realmente persistido (así la UI no diverge de la base).
export async function actualizarProducto(
  id: string,
  cambios: { precio_venta?: number; stock?: number },
): Promise<ResultadoGuardado> {
  const u = await getUsuarioActual();
  if (!u) return { ok: false, error: "No autorizado" };

  const patch: Record<string, number> = {};
  if (cambios.precio_venta !== undefined) {
    if (!Number.isFinite(cambios.precio_venta) || cambios.precio_venta < 0) {
      return { ok: false, error: "El precio no puede ser negativo." };
    }
    patch.precio_venta = cambios.precio_venta;
  }
  if (cambios.stock !== undefined) {
    if (!Number.isFinite(cambios.stock)) {
      return { ok: false, error: "Stock inválido." };
    }
    patch.stock = cambios.stock;
  }
  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "No hay cambios para guardar." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("productos")
    .update(patch)
    .eq("id", id)
    .select("precio_venta, stock")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "No se pudo guardar (sin permiso)." };
  return {
    ok: true,
    precio_venta: data.precio_venta === null ? null : Number(data.precio_venta),
    stock: Number(data.stock),
  };
}
