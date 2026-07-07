import { createClient } from "@/lib/supabase/server";

const FASES = [
  { n: 1, nombre: "Base", detalle: "Migración del catálogo, modelo de datos, auth y roles." },
  { n: 2, nombre: "POS / Cobro", detalle: "Venta, medios de pago, pistola, cierre de caja, offline." },
  { n: 3, nombre: "Dashboard", detalle: "Ventas, productos ganadores/perdedores, márgenes, auditoría." },
  { n: 4, nombre: "Facturas por Telegram", detalle: "Foto → IA de visión → revisión → impacta stock." },
  { n: 5, nombre: "Banco de horas", detalle: "Turnos semanales predefinidos y desvíos." },
  { n: 6, nombre: "Reposición", detalle: "Punto de reposición + faltantes → lista por WhatsApp." },
];

export default async function Home() {
  let supabaseOk = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.getUser();
    // Sin sesión iniciada, getUser devuelve "Auth session missing": la
    // conexión igual funciona. Solo un error de red/credenciales la rompe.
    supabaseOk = !error || error.message.toLowerCase().includes("session");
  } catch {
    supabaseOk = false;
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <span className="text-sm font-medium uppercase tracking-widest text-zinc-500">
          Minimercado
        </span>
        <h1 className="text-4xl font-semibold tracking-tight">Lo De Gómez</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Sistema de gestión: cobro, stock, caja, horas y reposición. En construcción.
        </p>
      </header>

      <div
        className={`inline-flex w-fit items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${
          supabaseOk
            ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300"
            : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"
        }`}
      >
        <span
          className={`h-2 w-2 rounded-full ${supabaseOk ? "bg-green-500" : "bg-red-500"}`}
        />
        {supabaseOk
          ? "Supabase conectado"
          : "Supabase sin conexión — revisá .env.local"}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-500">
          Fases
        </h2>
        <ol className="flex flex-col gap-2">
          {FASES.map((f) => (
            <li
              key={f.n}
              className="flex items-start gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-900">
                {f.n}
              </span>
              <div className="flex flex-col">
                <span className="font-medium">{f.nombre}</span>
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  {f.detalle}
                </span>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
