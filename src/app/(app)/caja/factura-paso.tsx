"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buscarClientes, crearCliente } from "@/lib/actions/clientes";
import { emitirComprobante, type ComprobanteImpresion } from "@/lib/actions/comprobantes";
import type { Cliente } from "@/lib/types";

// Panel post-venta: elegir tipo de factura y (para A) el cliente.
export function FacturaPaso({
  ventaId,
  onListo,
  onSaltar,
}: {
  ventaId: string;
  onListo: (data: ComprobanteImpresion) => void;
  onSaltar: () => void;
}) {
  const [emitiendo, setEmitiendo] = useState(false);
  const [modoA, setModoA] = useState(false);
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Cliente[]>([]);

  async function emitir(tipo: "A" | "B", clienteId?: string) {
    setEmitiendo(true);
    const res = await emitirComprobante({ venta_id: ventaId, tipo, cliente_id: clienteId });
    setEmitiendo(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success(`Factura ${tipo} emitida`);
    onListo(res.data);
  }

  async function buscar(term: string) {
    setQ(term);
    if (term.trim().length < 2) return setResultados([]);
    setResultados(await buscarClientes(term));
  }

  if (modoA) {
    return (
      <div className="flex flex-col gap-2">
        <Input
          autoFocus
          value={q}
          onChange={(e) => buscar(e.target.value)}
          placeholder="Buscar cliente por nombre o CUIT…"
          className="h-11"
        />
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {resultados.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={emitiendo}
              onClick={() => emitir("A", c.id)}
              className="rounded-lg border p-2 text-left hover:bg-accent"
            >
              {c.razon_social} · CUIT {c.doc_nro}
            </button>
          ))}
        </div>
        <AltaRapida
          disabled={emitiendo}
          sugerencia={q}
          onCreado={(c) => emitir("A", c.id)}
        />
        <Button variant="ghost" onClick={() => setModoA(false)}>
          ← Volver
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm text-muted-foreground">¿Factura?</span>
      <div className="grid grid-cols-3 gap-2">
        <Button variant="outline" disabled={emitiendo} onClick={onSaltar} className="h-12">
          Sin factura
        </Button>
        <Button disabled={emitiendo} onClick={() => emitir("B")} className="h-12">
          Factura B
        </Button>
        <Button variant="secondary" disabled={emitiendo} onClick={() => setModoA(true)} className="h-12">
          Factura A
        </Button>
      </div>
    </div>
  );
}

function AltaRapida({
  sugerencia,
  disabled,
  onCreado,
}: {
  sugerencia: string;
  disabled: boolean;
  onCreado: (c: Cliente) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [razon, setRazon] = useState("");
  const [cuit, setCuit] = useState(sugerencia.replace(/\D/g, ""));

  if (!abierto) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setCuit(sugerencia.replace(/\D/g, ""));
          setAbierto(true);
        }}
      >
        + Cliente nuevo
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-2">
      <Input value={razon} onChange={(e) => setRazon(e.target.value)} placeholder="Razón social" className="h-10" />
      <Input value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="CUIT" className="h-10" inputMode="numeric" />
      <Button
        size="sm"
        disabled={disabled}
        onClick={async () => {
          const res = await crearCliente({
            doc_tipo: 80,
            doc_nro: cuit,
            razon_social: razon,
            cond_iva: 1, // Responsable Inscripto (Factura A)
          });
          if (!res.ok) return toast.error(res.error);
          onCreado(res.cliente);
        }}
      >
        Guardar y facturar
      </Button>
    </div>
  );
}
