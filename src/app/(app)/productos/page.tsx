import { ProductosCliente } from "./productos-cliente";

export default function ProductosPage() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Productos</h1>
        <p className="text-sm text-muted-foreground">
          Buscá por nombre o código (tipeá o escaneá) y editá precio, costo o stock.
        </p>
      </div>
      <ProductosCliente />
    </div>
  );
}
