import { ReposicionCliente } from "./reposicion-cliente";

export default function ReposicionPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Reposición</h1>
        <p className="text-sm text-muted-foreground">
          Qué falta comprar: stock bajo automático + lo que cargues a mano.
        </p>
      </div>
      <ReposicionCliente />
    </div>
  );
}
