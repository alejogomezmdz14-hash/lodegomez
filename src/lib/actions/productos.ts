"use server";

import { createClient } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";

export type Resultado = { ok: true } | { ok: false; error: string };

// Edita precio y/o stock de un producto. La RLS + el trigger productos_guard_update
// limitan al empleado a precio_venta/stock; el trigger de auditoría registra el cambio.
export async function actualizarProducto(
  id: string,
  cambios: { precio_venta?: number; stock?: number },
): Promise<Resultado> {
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
  const { error } = await supabase.from("productos").update(patch).eq("id", id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
