"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, type Rol } from "@/lib/auth";

export type EmpleadoInput = {
  email: string;
  password: string;
  nombre: string;
  rol?: Rol; // por defecto 'empleado'
};

// Resultado de una acción: ok, o un error legible para mostrar en la UI.
export type Resultado = { ok: true } | { ok: false; error: string };

export type UsuarioListado = {
  id: string;
  nombre: string | null;
  rol: Rol;
  creado_en: string;
  email: string;
};

// Crea un usuario (empleado o admin). Solo un admin puede hacerlo.
export async function crearUsuario(input: EmpleadoInput): Promise<Resultado> {
  await requireAdmin();

  const email = input.email.trim().toLowerCase();
  const nombre = input.nombre.trim();
  if (!email || !input.password || !nombre) {
    return { ok: false, error: "Completá nombre, email y contraseña." };
  }
  if (input.password.length < 6) {
    return { ok: false, error: "La contraseña debe tener al menos 6 caracteres." };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true, // queda habilitado para entrar de una
    user_metadata: { nombre },
  });
  if (error) {
    const msg = /already|registered|exists/i.test(error.message)
      ? "Ya existe un usuario con ese email."
      : error.message;
    return { ok: false, error: msg };
  }

  // Ya no hay alta automática en signup: creamos la fila en public.usuarios
  // explícitamente, con el rol elegido.
  const { error: e2 } = await admin
    .from("usuarios")
    .upsert({ id: data.user.id, nombre, rol: input.rol ?? "empleado" });
  if (e2) return { ok: false, error: e2.message };
  return { ok: true };
}

// Cambia el rol de un usuario (empleado <-> admin).
export async function cambiarRol(usuarioId: string, rol: Rol): Promise<Resultado> {
  const yo = await requireAdmin();
  if (usuarioId === yo.id && rol !== "admin") {
    return { ok: false, error: "No podés quitarte a vos mismo el rol de admin." };
  }
  const admin = createAdminClient();
  const { error } = await admin.from("usuarios").update({ rol }).eq("id", usuarioId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Borra un usuario (auth + su perfil por cascada). No podés borrarte a vos mismo.
export async function borrarUsuario(usuarioId: string): Promise<Resultado> {
  const yo = await requireAdmin();
  if (usuarioId === yo.id) {
    return { ok: false, error: "No podés borrar tu propio usuario." };
  }
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(usuarioId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Lista los usuarios para la pantalla de empleados (incluye el email de auth).
export async function listarUsuarios(): Promise<UsuarioListado[]> {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: perfiles, error } = await admin
    .from("usuarios")
    .select("id, nombre, rol, creado_en")
    .order("creado_en", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: authList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailPorId = new Map(authList.users.map((u) => [u.id, u.email ?? ""]));

  return (perfiles ?? []).map((p) => ({
    id: p.id as string,
    nombre: (p.nombre as string | null) ?? null,
    rol: p.rol as Rol,
    creado_en: p.creado_en as string,
    email: emailPorId.get(p.id as string) ?? "",
  }));
}
