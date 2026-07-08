import { redirect } from "next/navigation";
import { getUsuarioActual } from "@/lib/auth";

// La raíz no es una landing: rutea según la sesión. Sin usuario → login;
// con usuario → directo a cobrar (el admin navega a /admin desde el shell).
export default async function Home() {
  const u = await getUsuarioActual();
  if (!u) redirect("/ingresar");
  redirect("/caja");
}
