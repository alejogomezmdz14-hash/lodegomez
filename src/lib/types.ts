// Tipos del dominio (a mano para el MVP; migrar a `supabase gen types` al
// estabilizar el schema, fin de Etapa 2/3).

export type MedioPago = "efectivo" | "qr" | "tarjeta" | "transferencia";
export type EstadoVenta = "activa" | "anulada" | "devuelta";

export const MEDIOS_PAGO: { valor: MedioPago; label: string }[] = [
  { valor: "efectivo", label: "Efectivo" },
  { valor: "qr", label: "QR" },
  { valor: "tarjeta", label: "Tarjeta" },
  { valor: "transferencia", label: "Transferencia" },
];

// Medios ofrecidos al cobrar (sin QR; en su lugar va "Dividir pago").
// MEDIOS_PAGO se mantiene completo para etiquetar ventas históricas con QR.
export const MEDIOS_COBRO = MEDIOS_PAGO.filter((m) => m.valor !== "qr");

// Columnas exactas de public.productos (migración 0001).
export type Producto = {
  id: string;
  codigo: string;
  descripcion: string | null;
  rubro: string | null;
  rubro_original: string | null;
  precio_costo: number | null;
  precio_venta: number | null;
  margen_pct: number | null;
  iva_pct: number;
  stock: number;
  stock_minimo: number | null;
  es_pesable: boolean;
  precio_por_kg: number | null;
  necesita_inventario: boolean;
  activo: boolean;
  modificado_por: string | null;
  modificado_en: string | null;
  creado_en: string;
  actualizado_en: string;
};

// Ítem del carrito (estado del cliente). `cantidad` = unidades, o kg si es pesable.
export type CartItem = {
  producto_id: string;
  codigo: string;
  descripcion: string;
  cantidad: number;
  es_pesable: boolean;
  precio_unit: number;
  iva_pct: number;
  subtotal: number;
};

// Lo que envía el cliente al RPC registrar_venta.
export type ItemVenta = { producto_id: string; cantidad: number };

// Un pago (medio + monto). Una venta puede tener varios (pago dividido).
export type Pago = { medio: MedioPago; monto: number };

// Payload que devuelve registrar_venta, para imprimir el ticket.
export type TicketItem = {
  codigo: string | null;
  descripcion: string | null;
  cantidad: number;
  es_pesable: boolean;
  precio_unit: number;
  subtotal: number;
};

export type VentaTicket = {
  id: string;
  ticket_nro: number;
  creada_en: string;
  medio_pago: MedioPago;
  es_mixto?: boolean;
  total: number;
  total_iva: number | null;
  items: TicketItem[];
  pagos?: Pago[];
};

// Resumen del turno (RPCs resumen_caja_actual / cerrar_caja).
export type ResumenCaja = {
  id?: string;
  caja_id: string;
  desde: string | null;
  hasta: string;
  cant_ventas: number;
  total: number;
  total_efectivo: number;
  total_qr: number;
  total_tarjeta: number;
  total_transferencia: number;
  egresos_efectivo?: number;
  egresos_transferencia?: number;
  efectivo_esperado?: number;
  efectivo_contado?: number | null;
  diferencia?: number | null;
};

// Egresos de caja (retiros + pagos a proveedores).
export type TipoEgreso = "retiro" | "pago_proveedor";

export type Egreso = {
  id: string;
  tipo: TipoEgreso;
  medio_pago: MedioPago;
  monto: number;
  detalle: string | null;
  cierre_id: string | null;
  creada_en: string;
  empleado_nombre?: string | null;
};

// Fila de la lista de ventas (pantalla de ventas/anulación).
export type VentaListado = {
  id: string;
  ticket_nro: number;
  creada_en: string;
  medio_pago: MedioPago;
  es_mixto?: boolean;
  total: number;
  estado: EstadoVenta;
  cierre_id: string | null;
  empleado_nombre: string | null;
};

// Ítem de un ticket (detalle expandible).
export type VentaItemDetalle = {
  codigo: string | null;
  descripcion: string | null;
  cantidad: number;
  es_pesable: boolean;
  precio_unit: number;
  subtotal: number;
};

// Dashboard (Etapa 3).
export type MetricasPeriodo = {
  total: number;
  cant_tickets: number;
  efectivo: number;
  qr: number;
  tarjeta: number;
  transferencia: number;
  margen: number;
  anulaciones: number;
};

export type RankingItem = {
  codigo: string | null;
  descripcion: string | null;
  unidades: number;
  facturado: number;
  margen: number;
};

export type TipoEvento = "anulacion" | "devolucion" | "alerta_precio";

export type EventoDueno = {
  id: string;
  tipo: TipoEvento;
  venta_id: string | null;
  ticket_nro: number | null;
  detalle: string | null;
  leido: boolean;
  creado_en: string;
};

// Reposición.
export type ProductoReponer = {
  id: string;
  codigo: string;
  descripcion: string | null;
  rubro: string | null;
  stock: number;
  stock_minimo: number;
};

export type RubroConfig = {
  rubro: string;
  cant: number;
  minimo_actual: number | null;
};

export type FaltanteManual = {
  id: string;
  texto: string;
  resuelto: boolean;
  creado_en: string;
};

// Historial de cierres.
export type CierreHistorial = {
  id: string;
  creado_en: string;
  hasta: string;
  caja_id?: string;
  cant_ventas: number;
  total: number;
  total_efectivo: number;
  total_qr: number;
  total_tarjeta: number;
  total_transferencia: number;
  egresos_efectivo?: number;
  efectivo_contado: number | null;
  diferencia: number | null;
  empleado_nombre: string | null;
};

// Ventas por empleado (dashboard).
export type VentaPorEmpleado = {
  empleado: string;
  tickets: number;
  total: number;
};

// Egresos de un período (dashboard).
export type EgresosPeriodo = {
  retiros: number;
  prov_efectivo: number;
  prov_transferencia: number;
  cantidad: number;
};

// ===== Fiscal (factura electrónica) =====
export type TipoFactura = "A" | "B";
export type EstadoComprobante = "pendiente" | "emitido" | "error";

// Condición IVA del receptor (coincide con CondicionIVAReceptorId de AFIP).
export const COND_IVA: { valor: number; label: string }[] = [
  { valor: 1, label: "Responsable Inscripto" },
  { valor: 6, label: "Monotributo" },
  { valor: 4, label: "Exento" },
  { valor: 5, label: "Consumidor Final" },
];

export type Cliente = {
  id: string;
  doc_tipo: number; // 80 CUIT | 96 DNI | 86 CUIL
  doc_nro: string;
  razon_social: string;
  domicilio: string | null;
  cond_iva: number;
  email: string | null;
  telefono: string | null;
  creado_en: string;
};

export type Comprobante = {
  id: string;
  venta_id: string;
  tipo: TipoFactura;
  cbte_tipo: number;
  punto_venta: number;
  numero: number | null;
  cliente_id: string | null;
  doc_tipo: number;
  doc_nro: string;
  cond_iva_receptor: number;
  cliente_nombre: string | null;
  neto: number;
  iva: number;
  exento: number;
  total: number;
  cae: string | null;
  cae_vto: string | null;
  qr_payload: string | null;
  estado: EstadoComprobante;
  error_detalle: string | null;
  emitido_en: string | null;
};

// Estado fiscal por venta, para la lista de ventas.
export type EstadoFiscal = "sin_factura" | "A" | "B" | "pendiente" | "error";
