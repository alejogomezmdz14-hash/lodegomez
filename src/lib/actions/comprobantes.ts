"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getUsuarioActual } from "@/lib/auth";
import {
  getAfip,
  armarVoucher,
  afipCuit,
  puntoVentaConfig,
  type ReceptorVoucher,
} from "@/lib/afip/client";
import { construirQrPayload, qrUrl, qrSvg } from "@/lib/afip/qr";
import type { Comprobante, TipoFactura } from "@/lib/types";

export type DatosFactura = {
  venta_id: string;
  tipo: TipoFactura;
  cliente_id?: string | null; // requerido para A
};

export type ComprobanteImpresion = { comprobante: Comprobante; qr_svg: string };

export type ResultadoComprobante =
  | { ok: true; data: ComprobanteImpresion }
  | { ok: false; error: string };

const COMP_COLS =
  "id,venta_id,tipo,cbte_tipo,punto_venta,numero,cliente_id,doc_tipo,doc_nro," +
  "cond_iva_receptor,cliente_nombre,neto,iva,exento,total,cae,cae_vto,qr_payload," +
  "estado,error_detalle,emitido_en";

// Emite (o reemite) una factura para una venta. Reclama la venta con una fila
// 'pendiente' ANTES de llamar a AFIP: así el índice único parcial impide la
// doble-emisión concurrente. La llamada a AFIP no se reintenta a ciegas (solo
// ante conflicto de numeración 10016).
export async function emitirComprobante(
  datos: DatosFactura,
): Promise<ResultadoComprobante> {
  const u = await getUsuarioActual();
  if (!u) return { ok: false, error: "No autorizado" };

  const admin = createAdminClient();

  // Venta + ítems.
  const { data: venta } = await admin
    .from("ventas")
    .select("id")
    .eq("id", datos.venta_id)
    .single();
  if (!venta) return { ok: false, error: "No existe la venta." };
  const { data: items } = await admin
    .from("venta_items")
    .select("subtotal,iva_pct")
    .eq("venta_id", datos.venta_id);
  if (!items || items.length === 0)
    return { ok: false, error: "La venta no tiene ítems." };

  // Receptor.
  let receptor: ReceptorVoucher;
  let clienteNombre: string | null = null;
  if (datos.tipo === "A") {
    if (!datos.cliente_id)
      return { ok: false, error: "La Factura A necesita un cliente." };
    const { data: cli } = await admin
      .from("clientes")
      .select("doc_tipo,doc_nro,razon_social,cond_iva")
      .eq("id", datos.cliente_id)
      .single();
    if (!cli) return { ok: false, error: "No existe el cliente." };
    receptor = {
      docTipo: cli.doc_tipo,
      docNro: Number(cli.doc_nro),
      condIva: cli.cond_iva,
    };
    clienteNombre = cli.razon_social;
  } else {
    receptor = { docTipo: 99, docNro: 0, condIva: 5 }; // B a consumidor final
  }

  const puntoVenta = puntoVentaConfig();
  const cbteTipo = datos.tipo === "A" ? 1 : 6;
  const itemsFiscales = items.map((it) => ({
    subtotal: Number(it.subtotal),
    iva_pct: Number(it.iva_pct),
  }));

  // Pre-armar: valida receptor/clase y calcula importes ANTES de reclamar.
  let importes;
  try {
    importes = armarVoucher({
      tipo: datos.tipo,
      puntoVenta,
      numero: 1,
      receptor,
      items: itemsFiscales,
    }).importes;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  const base = {
    venta_id: datos.venta_id,
    tipo: datos.tipo,
    cbte_tipo: cbteTipo,
    punto_venta: puntoVenta,
    cliente_id: datos.cliente_id ?? null,
    doc_tipo: receptor.docTipo,
    doc_nro: String(receptor.docNro),
    cond_iva_receptor: receptor.condIva,
    cliente_nombre: clienteNombre,
    neto: importes.neto,
    iva: importes.iva,
    exento: importes.exento,
    total: importes.total,
    emitido_por: u.id,
  };

  // === Reclamar la venta con una fila 'pendiente' ANTES de AFIP ===
  const { data: existente } = await admin
    .from("comprobantes")
    .select("id,estado,intentos")
    .eq("venta_id", datos.venta_id)
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  let rowId: string;
  let intentosPrevios = 0;
  if (existente) {
    if (existente.estado === "emitido")
      return { ok: false, error: "Esta venta ya está facturada." };
    // Reusar la fila previa (error/pendiente) reclamándola como 'pendiente'.
    intentosPrevios = existente.intentos ?? 0;
    const { error: eClaim } = await admin
      .from("comprobantes")
      .update({
        ...base,
        estado: "pendiente",
        numero: null,
        cae: null,
        cae_vto: null,
        qr_payload: null,
        error_detalle: null,
      })
      .eq("id", existente.id);
    if (eClaim) return { ok: false, error: "No se pudo iniciar la emisión." };
    rowId = existente.id;
  } else {
    // Insertar 'pendiente': si otra emisión concurrente ya insertó una fila
    // pendiente/emitido para esta venta, el índice único la rechaza y cortamos.
    const { data: ins, error: eIns } = await admin
      .from("comprobantes")
      .insert({ ...base, estado: "pendiente" })
      .select("id")
      .single();
    if (eIns || !ins)
      return {
        ok: false,
        error: "Ya hay una factura en curso o emitida para esta venta.",
      };
    rowId = ins.id;
  }

  // === Emitir en AFIP (reintento SOLO por conflicto de numeración 10016) ===
  const afip = getAfip();
  let cae = "";
  let caeVto = "";
  let numero = 0;
  let fechaCbte = "";
  let ultimoError = "";
  for (let intento = 0; intento < 3; intento++) {
    try {
      const last = (await afip.ElectronicBilling.getLastVoucher(
        puntoVenta,
        cbteTipo,
      )) as number;
      numero = Number(last) + 1;
      const armado = armarVoucher({
        tipo: datos.tipo,
        puntoVenta,
        numero,
        receptor,
        items: itemsFiscales,
      });
      fechaCbte = armado.fecha;
      const res = await afip.ElectronicBilling.createVoucher(armado.voucher);
      cae = res.CAE;
      caeVto = res.CAEFchVto; // yyyy-mm-dd
      break;
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
      // Solo el conflicto de numeración se reintenta. Cualquier otro error
      // (incluida una respuesta perdida) corta: NO re-emitir a ciegas.
      if (!/10016|no se corresponde/i.test(ultimoError)) break;
    }
  }

  if (!cae) {
    // Guardar 'error' registrando el numero intentado (para reconciliar a futuro
    // con FECompConsultar si AFIP llegó a autorizarlo — pendiente, fuera de MVP).
    await admin
      .from("comprobantes")
      .update({
        estado: "error",
        error_detalle: ultimoError || "No se pudo emitir",
        intentos: intentosPrevios + 1,
        numero: numero || null,
      })
      .eq("id", rowId);
    return { ok: false, error: `AFIP: ${ultimoError || "no se pudo emitir"}` };
  }

  // Éxito → QR (misma fecha del comprobante) y marcar 'emitido'.
  const qrPayload = construirQrPayload({
    fecha: fechaCbte,
    cuit: afipCuit(),
    ptoVta: puntoVenta,
    tipoCmp: cbteTipo,
    nroCmp: numero,
    importe: importes.total,
    docTipoRec: receptor.docTipo,
    docNroRec: receptor.docNro,
    cae,
  });

  const { data: guardado, error: eGuardar } = await admin
    .from("comprobantes")
    .update({
      estado: "emitido",
      numero,
      cae,
      cae_vto: caeVto,
      qr_payload: qrPayload,
      error_detalle: null,
      emitido_en: new Date().toISOString(),
    })
    .eq("id", rowId)
    .select(COMP_COLS)
    .single();
  if (eGuardar || !guardado) {
    return {
      ok: false,
      error: "Se emitió en AFIP pero falló el guardado. Revisá la venta.",
    };
  }

  const svg = await qrSvg(qrUrl(qrPayload));
  return {
    ok: true,
    data: { comprobante: guardado as unknown as Comprobante, qr_svg: svg },
  };
}

// Reintenta un comprobante que quedó en error (mismo path de emisión).
export async function reintentarComprobante(
  ventaId: string,
  tipo: TipoFactura,
  clienteId?: string,
) {
  return emitirComprobante({ venta_id: ventaId, tipo, cliente_id: clienteId });
}

// Estado fiscal de una lista de ventas (para la pantalla de ventas). Un
// 'emitido' siempre gana (nunca lo pisa un error/pendiente si coexistieran).
export async function estadosFiscales(
  ventaIds: string[],
): Promise<Record<string, { estado: string; tipo: string | null }>> {
  if (ventaIds.length === 0) return {};
  const admin = createAdminClient();
  const { data } = await admin
    .from("comprobantes")
    .select("venta_id,tipo,estado")
    .in("venta_id", ventaIds);
  const map: Record<string, { estado: string; tipo: string | null }> = {};
  for (const c of data ?? []) {
    const vid = c.venta_id as string;
    if (map[vid]?.estado === "emitido") continue; // no pisar un emitido
    map[vid] = { estado: c.estado as string, tipo: c.tipo as string };
  }
  return map;
}
