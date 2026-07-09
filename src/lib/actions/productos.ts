"use server";

import { createClient } from "@/lib/supabase/server";
import { getUsuarioActual } from "@/lib/auth";
import type { Producto } from "@/lib/types";

export type ResultadoGuardado =
  | {
      ok: true;
      precio_venta: number | null;
      precio_costo: number | null;
      stock: number;
    }
  | { ok: false; error: string };

// Edita precio de venta, COSTO y/o stock. Todos los usuarios provisionados
// pueden (guard sin congelar columnas); el trigger de auditoría lo registra.
export async function actualizarProducto(
  id: string,
  cambios: { precio_venta?: number; precio_costo?: number; stock?: number },
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
  if (cambios.precio_costo !== undefined) {
    if (!Number.isFinite(cambios.precio_costo) || cambios.precio_costo < 0) {
      return { ok: false, error: "El costo no puede ser negativo." };
    }
    patch.precio_costo = cambios.precio_costo;
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
    .select("precio_venta, precio_costo, stock")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "No se pudo guardar (sin permiso)." };
  return {
    ok: true,
    precio_venta: data.precio_venta === null ? null : Number(data.precio_venta),
    precio_costo: data.precio_costo === null ? null : Number(data.precio_costo),
    stock: Number(data.stock),
  };
}

export type NuevoProducto = {
  codigo: string;
  descripcion: string;
  rubro?: string;
  precio_venta: number; // si es pesable, es el precio por kg
  precio_costo?: number;
  es_pesable?: boolean;
};

export type ResultadoNuevo =
  | { ok: true; producto: Producto }
  | { ok: false; error: string };

// Alta de un producto (queda disponible para vender al instante).
export async function crearProducto(
  input: NuevoProducto,
): Promise<ResultadoNuevo> {
  const u = await getUsuarioActual();
  if (!u) return { ok: false, error: "No autorizado" };

  const codigo = input.codigo.trim();
  const descripcion = input.descripcion.trim();
  if (!codigo) return { ok: false, error: "Falta el código." };
  if (!descripcion) return { ok: false, error: "Falta la descripción." };

  const pesable = !!input.es_pesable;
  const precio = input.precio_venta;
  if (!Number.isFinite(precio) || precio <= 0) {
    return { ok: false, error: "Poné un precio de venta válido." };
  }
  const costo =
    input.precio_costo != null && Number.isFinite(input.precio_costo)
      ? input.precio_costo
      : null;
  if (costo != null && costo < 0) {
    return { ok: false, error: "El costo no puede ser negativo." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("productos")
    .insert({
      codigo,
      descripcion,
      rubro: input.rubro?.trim() || null,
      precio_venta: precio,
      precio_costo: costo,
      es_pesable: pesable,
      precio_por_kg: pesable ? precio : null,
      modificado_por: u.id,
      modificado_en: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) {
    const dup = /duplicate|unique|already|23505/i.test(error.message);
    return {
      ok: false,
      error: dup ? "Ya existe un producto con ese código." : error.message,
    };
  }
  return { ok: true, producto: data as Producto };
}
