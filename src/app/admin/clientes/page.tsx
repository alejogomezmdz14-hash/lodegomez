import { listarClientes } from "@/lib/actions/clientes";
import { ClientesCliente } from "./clientes-cliente";

export default async function ClientesPage() {
  const clientes = await listarClientes();
  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-bold">Clientes</h1>
      <ClientesCliente clientesIniciales={clientes} />
    </div>
  );
}
