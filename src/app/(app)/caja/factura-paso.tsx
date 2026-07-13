"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buscarClientes, crearCliente } from "@/lib/actions/clientes";
import { emitirComprobante, type ComprobanteImpresion } from "@/lib/actions/comprobantes";
import { COND_IVA, type Cliente } from "@/lib/types";

// Condiciones de IVA válidas como receptor de Factura A (no Consumidor Final).
const COND_IVA_A = COND_IVA.filter((c) => c.valor !== 5);

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
  const [domicilio, setDomicilio] = useState("");
  const [condIva, setCondIva] = useState(1); // Responsable Inscripto por defecto
  const [guardando, setGuardando] = useState(false);

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
      <Input
        value={cuit}
        onChange={(e) => setCuit(e.target.value)}
        placeholder="CUIT (con o sin guiones)"
        className="h-10"
        inputMode="numeric"
      />
      <Input
        value={domicilio}
        onChange={(e) => setDomicilio(e.target.value)}
        placeholder="Domicilio"
        className="h-10"
      />
      <select
        value={condIva}
        onChange={(e) => setCondIva(Number(e.target.value))}
        className="h-10 rounded-lg border-2 border-border bg-background px-2 text-sm"
      >
        {COND_IVA_A.map((c) => (
          <option key={c.valor} value={c.valor}>
            {c.label}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        disabled={disabled || guardando}
        onClick={async () => {
          setGuardando(true);
          const res = await crearCliente({
            doc_tipo: 80,
            doc_nro: cuit,
            razon_social: razon,
            domicilio: domicilio || undefined,
            cond_iva: condIva,
          });
          setGuardando(false);
          if (!res.ok) return toast.error(res.error);
          onCreado(res.cliente);
        }}
      >
        {guardando ? "Guardando…" : "Guardar y facturar"}
      </Button>
    </div>
  );
}
