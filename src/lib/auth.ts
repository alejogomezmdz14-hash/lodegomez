import { createClient } from "@/lib/supabase/server";

export type Rol = "empleado" | "admin";
export type UsuarioActual = { id: string; nombre: string | null; rol: Rol };

// Devuelve el perfil (usuarios) del usuario logueado, o null si no hay sesión.
export async function getUsuarioActual(): Promise<UsuarioActual | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("usuarios")
    .select("id, nombre, rol")
    .eq("id", user.id)
    .single();

  return data ?? null;
}

export async function esAdmin(): Promise<boolean> {
  const u = await getUsuarioActual();
  return u?.rol === "admin";
}

// Lanza si el que llama no es admin. Usar al inicio de acciones sensibles.
export async function requireAdmin(): Promise<UsuarioActual> {
  const u = await getUsuarioActual();
  if (u?.rol !== "admin") throw new Error("No autorizado: se requiere admin");
  return u;
}
