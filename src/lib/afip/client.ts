import "server-only";
import Afip from "@afipsdk/afip.js";
import { calcularImportes } from "./calculo";
import type { CartItem, TipoFactura } from "@/lib/types";

// Instancia de AFIP SDK. Homologación (por defecto): solo { CUIT, access_token }
// (el CUIT de prueba 20409378472 no requiere certificado). Producción: además
// cert + key (PEM autorizado) y production: true.
export function getAfip(): Afip {
  return new Afip({
    CUIT: afipCuit(),
    // La lib tipa access_token como string requerido; en runtime puede faltar
    // (se pasa tal cual, undefined incluido). Cast compile-time, sin cambiar el payload.
    access_token: process.env.AFIP_ACCESS_TOKEN as string,
    ...(process.env.AFIP_ENV === "produccion"
      ? { cert: process.env.AFIP_CERT, key: process.env.AFIP_KEY, production: true }
      : {}),
  });
}

// CUIT emisor y punto de venta para emisión/QR (server-only, desde env).
export function afipCuit(): number {
  return Number(process.env.AFIP_CUIT ?? "20409378472");
}
export function puntoVentaConfig(): number {
  return Number(process.env.AFIP_PTO_VTA ?? "1");
}

export type ReceptorVoucher = {
  docTipo: number; // 99 | 80 | 96
  docNro: number; // 0 en CF
  condIva: number; // A: 1 RI / 6 Mono… | B: 5 CF / 4 Exento
};

// CbteFch como ENTERO (yyyymmdd), en fecha de Argentina (el server corre en UTC,
// así cerca de medianoche no se adelanta un día).
function cbteFch(): { entero: number; iso: string } {
  const iso = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }); // 'yyyy-mm-dd'
  return { entero: Number(iso.replace(/-/g, "")), iso };
}

// Condiciones IVA válidas por clase de comprobante (AFIP rechaza combinaciones
// inválidas: p.ej. Consumidor Final en Factura A → error 10245/10242).
const COND_A = new Set([1, 6, 13, 16]); // A: Responsable Inscripto / Monotributo
const COND_B = new Set([4, 5, 7, 8, 9, 10]); // B: Exento / Consumidor Final / etc.

// Arma el objeto data de createVoucher a partir de los ítems de la venta.
export function armarVoucher(params: {
  tipo: TipoFactura;
  puntoVenta: number;
  numero: number;
  receptor: ReceptorVoucher;
  items: { subtotal: number; iva_pct: number }[];
}) {
  const { tipo, puntoVenta, numero, receptor, items } = params;

  // Validación clase ↔ receptor.
  if (tipo === "A") {
    if (receptor.docTipo !== 80)
      throw new Error("Factura A requiere CUIT del cliente (DocTipo 80).");
    if (!COND_A.has(receptor.condIva))
      throw new Error("Factura A: el receptor debe ser Responsable Inscripto o Monotributo.");
  } else if (!COND_B.has(receptor.condIva)) {
    throw new Error("Factura B: condición IVA del receptor inválida.");
  }

  const imp = calcularImportes(items);
  const fch = cbteFch();
  return {
    voucher: {
      CantReg: 1,
      PtoVta: puntoVenta,
      CbteTipo: tipo === "A" ? 1 : 6,
      Concepto: 1,
      DocTipo: receptor.docTipo,
      DocNro: receptor.docNro,
      CbteDesde: numero,
      CbteHasta: numero,
      CbteFch: fch.entero,
      ImpTotal: imp.total,
      ImpTotConc: 0,
      ImpNeto: imp.neto,
      ImpOpEx: imp.exento,
      ImpIVA: imp.iva,
      ImpTrib: 0,
      MonId: "PES",
      MonCotiz: 1,
      CondicionIVAReceptorId: receptor.condIva,
      ...(imp.iva_items.length > 0 ? { Iva: imp.iva_items } : {}),
    },
    importes: imp,
    fecha: fch.iso, // para el QR (misma fecha del comprobante)
  };
}

// Ítems mínimos para calcular (compat con CartItem y con lo leído de la DB).
export type ItemFiscal = Pick<CartItem, "subtotal" | "iva_pct">;
