"use client";

import { useEffect, useState } from "react";
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
  onVolver,
}: {
  ventaId: string;
  onListo: (data: ComprobanteImpresion) => void;
  onSaltar: () => void;
  onVolver?: () => void;
}) {
  const [emitiendo, setEmitiendo] = useState(false);
  const [modoA, setModoA] = useState(false);
  const [q, setQ] = useState("");
  const [resultados, setResultados] = useState<Cliente[]>([]);
  const [sel, setSel] = useState(0); // 0 Sin factura · 1 Factura B · 2 Factura A

  // Flechas eligen la opción; Enter la confirma; Esc vuelve (cancela la venta).
  useEffect(() => {
    if (modoA) return;
    function onKey(e: KeyboardEvent) {
      // Si hay un campo enfocado (p. ej. el diálogo del motivo de anulación
      // abierto encima), las teclas son de ese campo, no de este panel.
      const el = document.activeElement;
      if (
        el &&
        ["INPUT", "TEXTAREA", "SELECT"].includes((el as HTMLElement).tagName)
      ) {
        return;
      }
      if (["ArrowLeft", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setSel((s) => (s + 2) % 3);
      } else if (["ArrowRight", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        setSel((s) => (s + 1) % 3);
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (emitiendo) return;
        if (sel === 0) onSaltar();
        else if (sel === 1) emitir("B");
        else setModoA(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (!emitiendo) onVolver?.();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoA, sel, emitiendo]);

  async function emitir(tipo: "A" | "B", clienteId?: string) {
    setEmitiendo(true);
    const res = await emitirComprobante({ venta_id: ventaId, tipo, cliente_id: clienteId });
    setEmitiendo(false);
    if (!res.ok) {
      toast.error(res.error, { duration: 10000 });
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
        <Button
          variant={sel === 0 ? "default" : "outline"}
          disabled={emitiendo}
          onClick={onSaltar}
          className="h-12"
        >
          Sin factura
        </Button>
        <Button
          variant={sel === 1 ? "default" : "outline"}
          disabled={emitiendo}
          onClick={() => emitir("B")}
          className="h-12"
        >
          Factura B
        </Button>
        <Button
          variant={sel === 2 ? "default" : "outline"}
          disabled={emitiendo}
          onClick={() => setModoA(true)}
          className="h-12"
        >
          Factura A
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        Flechas ← → para elegir · Enter para confirmar
      </p>
      {onVolver ? (
        <button
          type="button"
          disabled={emitiendo}
          onClick={onVolver}
          className="text-center text-xs font-medium text-destructive hover:underline"
        >
          ← Volver (cancelar esta venta)
        </button>
      ) : null}
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
