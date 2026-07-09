"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { crearCliente, actualizarCliente } from "@/lib/actions/clientes";
import { COND_IVA, type Cliente } from "@/lib/types";

export function ClientesCliente({ clientesIniciales }: { clientesIniciales: Cliente[] }) {
  const router = useRouter();
  const [editando, setEditando] = useState<Cliente | null>(null);
  const [nuevo, setNuevo] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <Button onClick={() => { setNuevo(true); setEditando(null); }} className="self-start">
        + Nuevo cliente
      </Button>

      {(nuevo || editando) && (
        <FormularioCliente
          key={editando?.id ?? "nuevo"}
          cliente={editando}
          onGuardado={() => { setNuevo(false); setEditando(null); router.refresh(); }}
          onCancelar={() => { setNuevo(false); setEditando(null); }}
        />
      )}

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Razón social</th>
              <th className="px-4 py-3">Documento</th>
              <th className="px-4 py-3">Cond. IVA</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {clientesIniciales.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <td className="px-4 py-3">{c.razon_social}</td>
                <td className="px-4 py-3 tabular-nums">{c.doc_nro}</td>
                <td className="px-4 py-3">
                  {COND_IVA.find((x) => x.valor === c.cond_iva)?.label ?? c.cond_iva}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button size="sm" variant="outline" onClick={() => { setEditando(c); setNuevo(false); }}>
                    Editar
                  </Button>
                </td>
              </tr>
            ))}
            {clientesIniciales.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Sin clientes.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FormularioCliente({
  cliente,
  onGuardado,
  onCancelar,
}: {
  cliente: Cliente | null;
  onGuardado: () => void;
  onCancelar: () => void;
}) {
  const [razon, setRazon] = useState(cliente?.razon_social ?? "");
  const [docNro, setDocNro] = useState(cliente?.doc_nro ?? "");
  const [condIva, setCondIva] = useState(cliente?.cond_iva ?? 1);
  const [domicilio, setDomicilio] = useState(cliente?.domicilio ?? "");
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    const input = { doc_tipo: 80, doc_nro: docNro, razon_social: razon, cond_iva: condIva, domicilio };
    const res = cliente
      ? await actualizarCliente(cliente.id, input)
      : await crearCliente(input);
    setGuardando(false);
    if (!res.ok) return toast.error(res.error);
    toast.success("Cliente guardado");
    onGuardado();
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border p-4">
      <Input value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Razón social" />
      <Input value={docNro} onChange={(e) => setDocNro(e.target.value)} placeholder="CUIT" inputMode="numeric" />
      <Input value={domicilio} onChange={(e) => setDomicilio(e.target.value)} placeholder="Domicilio" />
      <select
        value={condIva}
        onChange={(e) => setCondIva(Number(e.target.value))}
        className="h-10 rounded-md border px-2"
      >
        {COND_IVA.map((c) => (
          <option key={c.valor} value={c.valor}>{c.label}</option>
        ))}
      </select>
      <div className="flex gap-2">
        <Button onClick={guardar} disabled={guardando}>Guardar</Button>
        <Button variant="ghost" onClick={onCancelar}>Cancelar</Button>
      </div>
    </div>
  );
}
