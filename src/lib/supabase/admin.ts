import { createClient } from "@supabase/supabase-js";

// Cliente admin de Supabase (usa la service_role key: saltea RLS y puede
// crear/borrar usuarios de auth). SOLO server-side.
//
// Seguridad: SUPABASE_SERVICE_ROLE_KEY no tiene el prefijo NEXT_PUBLIC_, así
// que Next.js nunca la manda al navegador (allá es undefined). Este módulo lo
// importan únicamente Server Actions / Route Handlers.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
