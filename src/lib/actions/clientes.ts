"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getUsuarioActual, requireAdmin } from "@/lib/auth";
import { validarCuit } from "@/lib/afip/cuit";
import type { Cliente } from "@/lib/types";

export type ResultadoCliente =
  | { ok: true; cliente: Cliente }
  | { ok: false; error: string };

const COLS =
  "id,doc_tipo,doc_nro,razon_social,domicilio,cond_iva,email,telefono,creado_en";

// Busca clientes por razón social o número de documento (para el POS y el admin).
export async function buscarClientes(q: string): Promise<Cliente[]> {
  const u = await getUsuarioActual();
  if (!u) return [];
  const admin = createAdminClient();
  // Sanitizar: sacar chars que rompen el filtro .or de PostgREST (, ( ) % *).
  const term = q.trim().replace(/[,()%*]/g, " ").trim();
  let query = admin.from("clientes").select(COLS).order("razon_social").limit(20);
  if (term) query = query.or(`razon_social.ilike.%${term}%,doc_nro.ilike.%${term}%`);
  const { data } = await query;
  return (data as Cliente[] | null) ?? [];
}

export async function listarClientes(): Promise<Cliente[]> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin.from("clientes").select(COLS).order("razon_social");
  return (data as Cliente[] | null) ?? [];
}

export type ClienteInput = {
  doc_tipo: number;
  doc_nro: string;
  razon_social: string;
  domicilio?: string;
  cond_iva: number;
  email?: string;
  telefono?: string;
};

function validar(input: ClienteInput): string | null {
  if (!input.razon_social.trim()) return "Falta la razón social.";
  const doc = input.doc_nro.replace(/\D/g, "");
  if (input.doc_tipo === 80 && !validarCuit(doc)) return "CUIT inválido.";
  if (input.doc_tipo === 96 && (doc.length < 7 || doc.length > 8)) return "DNI inválido.";
  return null;
}

// Alta de cliente (empleado o admin: se usa en el POS para Factura A).
export async function crearCliente(input: ClienteInput): Promise<ResultadoCliente> {
  const u = await getUsuarioActual();
  if (!u) return { ok: false, error: "No autorizado" };
  const err = validar(input);
  if (err) return { ok: false, error: err };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clientes")
    .insert({
      doc_tipo: input.doc_tipo,
      doc_nro: input.doc_nro.replace(/\D/g, ""),
      razon_social: input.razon_social.trim(),
      domicilio: input.domicilio?.trim() || null,
      cond_iva: input.cond_iva,
      email: input.email?.trim() || null,
      telefono: input.telefono?.trim() || null,
      creado_por: u.id,
    })
    .select(COLS)
    .single();
  if (error) {
    const msg = /duplicate|unique/i.test(error.message)
      ? "Ya existe un cliente con ese documento."
      : error.message;
    return { ok: false, error: msg };
  }
  return { ok: true, cliente: data as Cliente };
}

// Edición (solo admin).
export async function actualizarCliente(
  id: string,
  input: ClienteInput,
): Promise<ResultadoCliente> {
  await requireAdmin();
  const err = validar(input);
  if (err) return { ok: false, error: err };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clientes")
    .update({
      doc_tipo: input.doc_tipo,
      doc_nro: input.doc_nro.replace(/\D/g, ""),
      razon_social: input.razon_social.trim(),
      domicilio: input.domicilio?.trim() || null,
      cond_iva: input.cond_iva,
      email: input.email?.trim() || null,
      telefono: input.telefono?.trim() || null,
    })
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, cliente: data as Cliente };
}
