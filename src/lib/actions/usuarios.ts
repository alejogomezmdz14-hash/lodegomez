"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin, type Rol } from "@/lib/auth";

export type EmpleadoInput = {
  email: string;
  password: string;
  nombre: string;
  rol?: Rol; // por defecto 'empleado'
};

// Crea un usuario (empleado o admin). Solo un admin puede hacerlo.
export async function crearUsuario(input: EmpleadoInput) {
  await requireAdmin();
  const admin = createAdminClient();

  const { data, error } = await admin.auth.admin.createUser({
    email: input.email.trim().toLowerCase(),
    password: input.password,
    email_confirm: true, // queda habilitado para entrar de una
    user_metadata: { nombre: input.nombre.trim() },
  });
  if (error) throw new Error(error.message);

  // El trigger handle_new_user ya creó la fila en public.usuarios como 'empleado'.
  // Si se pidió admin, lo ascendemos.
  if (input.rol === "admin") {
    const { error: e2 } = await admin
      .from("usuarios")
      .update({ rol: "admin" })
      .eq("id", data.user.id);
    if (e2) throw new Error(e2.message);
  }
  return data.user.id;
}

// Cambia el rol de un usuario (empleado <-> admin).
export async function cambiarRol(usuarioId: string, rol: Rol) {
  const yo = await requireAdmin();
  if (usuarioId === yo.id && rol !== "admin") {
    throw new Error("No podés quitarte a vos mismo el rol de admin");
  }
  const admin = createAdminClient();
  const { error } = await admin.from("usuarios").update({ rol }).eq("id", usuarioId);
  if (error) throw new Error(error.message);
}

// Borra un usuario (auth + su perfil por cascada). No podés borrarte a vos mismo.
export async function borrarUsuario(usuarioId: string) {
  const yo = await requireAdmin();
  if (usuarioId === yo.id) throw new Error("No podés borrar tu propio usuario");

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(usuarioId);
  if (error) throw new Error(error.message);
}

// Lista los usuarios para la pantalla de empleados (incluye el email de auth).
export async function listarUsuarios() {
  await requireAdmin();
  const admin = createAdminClient();

  const { data: perfiles, error } = await admin
    .from("usuarios")
    .select("id, nombre, rol, creado_en")
    .order("creado_en", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: authList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const emailPorId = new Map(authList.users.map((u) => [u.id, u.email ?? ""]));

  return (perfiles ?? []).map((p) => ({ ...p, email: emailPorId.get(p.id) ?? "" }));
}
