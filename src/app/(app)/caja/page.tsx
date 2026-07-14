import { getUsuarioActual } from "@/lib/auth";
import { CajaCliente } from "./caja-cliente";

export default async function CajaPage() {
  const u = await getUsuarioActual();
  return <CajaCliente esAdmin={u?.rol === "admin"} />;
}
