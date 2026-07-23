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

// AFIP devuelve fechas como yyyymmdd (número o string); el QR y la DB usan
// yyyy-mm-dd.
function fechaAfipAIso(v: number | string): string {
  const s = String(v);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

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
    .select("id,estado,intentos,numero")
    .eq("venta_id", datos.venta_id)
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();

  let rowId: string;
  let intentosPrevios = 0;
  if (existente) {
    if (existente.estado === "emitido")
      return { ok: false, error: "Esta venta ya está facturada." };

    // === Reconciliar con AFIP ANTES de reintentar (anti doble-CAE) ===
    // Un intento previo pudo haber sido AUTORIZADO por AFIP aunque la respuesta
    // se perdiera (o falló el guardado): la fila quedó error/pendiente con un
    // 'numero' guardado que YA tiene CAE en AFIP. Reemitir a ciegas pediría un
    // segundo CAE para la misma venta (doble IVA declarado). Consultamos ese
    // número: si ya está autorizado lo adoptamos; si no existe, seguimos; si no
    // se puede verificar (AFIP/red caída), NO emitimos.
    if (existente.numero != null) {
      const afipRec = getAfip();
      let info: {
        CodAutorizacion?: string | number;
        FchVto?: string | number;
        CbteFch?: string | number;
      } | null;
      try {
        info = (await afipRec.ElectronicBilling.getVoucherInfo(
          existente.numero,
          puntoVenta,
          cbteTipo,
        )) as {
          CodAutorizacion?: string | number;
          FchVto?: string | number;
          CbteFch?: string | number;
        } | null;
      } catch {
        // Inconcluso: no sabemos si AFIP autorizó ese número. NO emitir.
        return {
          ok: false,
          error:
            "No se pudo verificar el estado en AFIP. Reintentá cuando haya conexión.",
        };
      }

      if (info && info.CodAutorizacion) {
        // Ya autorizado en AFIP → adoptarlo tal cual, sin re-emitir.
        const caeAdopt = String(info.CodAutorizacion);
        const caeVtoAdopt = info.FchVto ? fechaAfipAIso(info.FchVto) : "";
        const fechaAdopt = info.CbteFch ? fechaAfipAIso(info.CbteFch) : "";
        const qrPayloadAdopt = construirQrPayload({
          fecha: fechaAdopt,
          cuit: afipCuit(),
          ptoVta: puntoVenta,
          tipoCmp: cbteTipo,
          nroCmp: existente.numero,
          importe: importes.total,
          docTipoRec: receptor.docTipo,
          docNroRec: receptor.docNro,
          cae: caeAdopt,
        });
        const { data: adoptado, error: eAdopt } = await admin
          .from("comprobantes")
          .update({
            ...base,
            estado: "emitido",
            numero: existente.numero,
            cae: caeAdopt,
            cae_vto: caeVtoAdopt,
            qr_payload: qrPayloadAdopt,
            error_detalle: null,
            emitido_en: new Date().toISOString(),
          })
          .eq("id", existente.id)
          .select(COMP_COLS)
          .single();
        if (eAdopt || !adoptado) {
          return {
            ok: false,
            error:
              "Se emitió en AFIP pero falló el guardado. Revisá la venta.",
          };
        }
        const svgAdopt = await qrSvg(qrUrl(qrPayloadAdopt));
        return {
          ok: true,
          data: {
            comprobante: adoptado as unknown as Comprobante,
            qr_svg: svgAdopt,
          },
        };
      }
      // info === null → ese número nunca se autorizó en AFIP → seguir normal.
    }

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
    // 1) Último autorizado: es una CONSULTA (no genera CAE) → se puede reintentar
    //    sin riesgo ante caídas de red (ECONNRESET, fetch failed, timeouts).
    let last: number | null = null;
    for (let g = 0; g < 3; g++) {
      try {
        last = Number(
          await afip.ElectronicBilling.getLastVoucher(puntoVenta, cbteTipo),
        );
        break;
      } catch (e) {
        ultimoError = e instanceof Error ? e.message : String(e);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    if (last === null) break; // no se pudo ni consultar (AFIP/red caída) → cortar

    numero = last + 1;
    const armado = armarVoucher({
      tipo: datos.tipo,
      puntoVenta,
      numero,
      receptor,
      items: itemsFiscales,
    });
    fechaCbte = armado.fecha;

    // 2) Emitir: UNA sola vez por número. Solo el conflicto de numeración (10016)
    //    se reintenta (con un número nuevo); cualquier otro error corta para NO
    //    re-emitir a ciegas y arriesgar un doble CAE.
    try {
      const res = await afip.ElectronicBilling.createVoucher(armado.voucher);
      cae = res.CAE;
      caeVto = res.CAEFchVto; // yyyy-mm-dd
      break;
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
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

// Reintenta el comprobante de una venta reusando su tipo y cliente guardados
// (no convierte una Factura A fallida en B).
export async function reintentarComprobante(
  ventaId: string,
): Promise<ResultadoComprobante> {
  const u = await getUsuarioActual();
  if (!u) return { ok: false, error: "No autorizado" };
  const admin = createAdminClient();
  const { data: c } = await admin
    .from("comprobantes")
    .select("tipo,cliente_id")
    .eq("venta_id", ventaId)
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!c) return { ok: false, error: "No hay comprobante para reintentar." };
  return emitirComprobante({
    venta_id: ventaId,
    tipo: c.tipo as TipoFactura,
    cliente_id: (c.cliente_id as string | null) ?? undefined,
  });
}

// Estado fiscal de una lista de ventas (para la pantalla de ventas). Un
// 'emitido' siempre gana (nunca lo pisa un error/pendiente si coexistieran).
export async function estadosFiscales(
  ventaIds: string[],
): Promise<Record<string, { estado: string; tipo: string | null }>> {
  const u = await getUsuarioActual();
  if (!u) return {};
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
