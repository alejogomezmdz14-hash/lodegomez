// Crea (o encuentra) un usuario de Supabase Auth y lo deja como admin.
// Uso: node scripts/crear-admin.mjs <email> <password> [nombre]
// Lee las credenciales de .env.local (no las hardcodea).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(p) {
  const env = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const email = process.argv[2];
const password = process.argv[3];
const nombre = process.argv[4] || "Admin";
if (!email || !password) {
  console.error("Uso: node scripts/crear-admin.mjs <email> <password> [nombre]");
  process.exit(1);
}

const env = loadEnv(".env.local");
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const admin = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let userId = null;
const created = await admin.auth.admin.createUser({
  email: email.toLowerCase(),
  password,
  email_confirm: true,
  user_metadata: { nombre },
});

if (created.error) {
  if (/already|registered|exists/i.test(created.error.message)) {
    const list = await admin.auth.admin.listUsers({ perPage: 1000 });
    const f = list.data.users.find(
      (u) => (u.email || "").toLowerCase() === email.toLowerCase(),
    );
    if (!f) {
      console.error("Ya existe pero no lo encontre:", created.error.message);
      process.exit(1);
    }
    userId = f.id;
    console.log("Usuario ya existia. id:", userId);
  } else {
    console.error("Error creando usuario:", created.error.message);
    process.exit(1);
  }
} else {
  userId = created.data.user.id;
  console.log("Usuario creado. id:", userId);
}

const up = await admin
  .from("usuarios")
  .upsert({ id: userId, nombre, rol: "admin" }, { onConflict: "id" });

if (up.error) {
  console.error("ROL_FALLO:", up.error.message);
  console.error(
    "El login YA quedo creado, pero falta la tabla public.usuarios. Aplica 0001_fase1.sql y volve a correr este mismo comando.",
  );
  process.exit(2);
}

const perfil = await admin
  .from("usuarios")
  .select("id, nombre, rol")
  .eq("id", userId)
  .single();
console.log("OK ADMIN:", JSON.stringify(perfil.data));
