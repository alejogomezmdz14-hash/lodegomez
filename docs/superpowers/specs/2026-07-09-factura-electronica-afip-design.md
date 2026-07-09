# Factura electrónica (AFIP SDK) — Diseño (2026-07-09)

## Objetivo
Emitir **factura electrónica A y B** desde el POS, integrando con **AFIP/ARCA** vía
**AFIP SDK** (nube, con `access_token`). La factura es un **paso opcional** sobre una
venta ya registrada: se obtiene el **CAE** online, se guarda el comprobante y se
imprime el ticket fiscal con **QR** en la térmica. El ticket fiscal debe replicar el
layout del comprobante que hoy emite Easy POS.

## Alcance (esta iteración)
- **Factura B** (consumidor final) y **Factura A** (cliente Responsable Inscripto, con CUIT).
- Emisión **en el cobro** (paso opcional `Sin factura` / `Factura B` / `Factura A`) y
  **desde la lista de ventas** (facturar un ticket ya hecho, ver estado, reintentar).
- **Lista de clientes** (`clientes`): alta/edición en admin + buscador con alta rápida
  en el POS para Factura A.
- **Ticket fiscal** con encabezado del emisor, detalle, total, **Régimen de
  Transparencia Fiscal (Ley 27742)** en B, CAE + vto y **QR** (SVG inline).
- Estados de comprobante `pendiente` / `emitido` / `error` con **reintento** (cubre el
  caso "no había internet, se emite después").
- Todo se construye y prueba primero en **homologación** (CUIT de prueba, sin certificado).

**Fuera de alcance (YAGNI por ahora):** notas de crédito (devoluciones facturadas),
generación/envío de PDF por WhatsApp/email, consulta de padrón para autocompletar
razón social, conciliación. Se suman después.

## Decisiones clave
- Condición del emisor: **Responsable Inscripto** → Factura A (`CbteTipo 1`) y B (`CbteTipo 6`).
- Enfoque de credenciales: **nube AFIP SDK** con `access_token` (la nube custodia el
  certificado; nosotros guardamos solo el token). Sin manejar la clave privada.
- La facturación es un **atributo** de la venta: **toda** venta imprime ticket y aparece
  en la lista por igual, esté facturada o no. Cierre de caja, dashboard y stock siguen
  mirando `ventas` sin cambios.
- `registrar_venta` **no se toca**. La emisión es una Server Action aparte (llama a una
  API externa; no puede vivir en una función de Postgres).
- **Punto de venta**: como la facturación pasa a hacerse **solo con este sistema**, se
  **reutiliza el `0007`** (AFIP continúa la numeración desde el último CAE emitido).
  Requisitos: (a) que Easy POS **deje de emitir facturas** antes de arrancar en producción,
  y (b) confirmar que `0007` es de tipo *Web Services*. Configurable por env
  (`AFIP_PTO_VTA`); si se prefiere un arranque limpio, se puede dar de alta un PdV nuevo.

## Modelo de datos (migración nueva)

### `clientes`
```
id            uuid pk
doc_tipo      int          -- 80 CUIT | 96 DNI | 86 CUIL
doc_nro       text         -- único por (doc_tipo, doc_nro)
razon_social  text
domicilio     text null
cond_iva      int          -- 1 RI | 6 Monotributo | 4 Exento | 5 Consumidor Final
email         text null
telefono      text null
creado_por    uuid → usuarios null
creado_en, actualizado_en  timestamptz
```
RLS: lectura para usuarios provisionados; escritura vía Server Action / RPC (como el
resto). Alta rápida desde el POS y edición desde el admin.

### `comprobantes`
```
id            uuid pk
venta_id      uuid → ventas
tipo          text         -- 'A' | 'B'
cbte_tipo     int          -- 1 | 6
punto_venta   int
numero        bigint null  -- lo asigna AFIP (getLastVoucher+1); null hasta emitir
-- receptor
cliente_id    uuid → clientes null   -- null en B a consumidor final
doc_tipo      int          -- 99 CF | 80 CUIT | 96 DNI  (snapshot)
doc_nro       text         -- '0' en CF                  (snapshot)
cond_iva_receptor int      -- 5 CF (B) | 1 RI (A)
cliente_nombre text null   -- snapshot para el ticket
-- importes
neto, iva, exento, total  numeric(12,2)
-- resultado AFIP
cae           text null
cae_vto       date null
qr_payload    text null    -- base64 para construir el QR
estado        text default 'pendiente'  -- 'pendiente' | 'emitido' | 'error'
error_detalle text null
intentos      int default 0
emitido_en    timestamptz null
creado_en     timestamptz default now()
```
- **Índice único parcial** en `venta_id` cuando `estado in ('pendiente','emitido')`
  → una venta no se factura dos veces (en `error` se permite reintentar).
- RLS: lectura usuarios; sin escritura desde clientes (solo Server Action / RPC).

## Cálculo fiscal (precios con-IVA → campos AFIP)
Los precios ya incluyen IVA. Por cada comprobante, agrupando ítems por `iva_pct`:
- Grupo gravado (21, 10,5): `neto = round(bruto / (1 + pct/100), 2)`, `iva = bruto − neto`
  → entrada en array `Iva` de AFIP (`Id 5`=21%, `Id 4`=10,5%; `BaseImp`=neto, `Importe`=iva).
- Grupo exento (`iva_pct` 0) → suma a `ImpOpEx` (no va al array `Iva`).
- `ImpNeto = Σ neto`, `ImpIVA = Σ iva`, `ImpTotal = total de la venta`, `ImpTotConc=0`,
  `ImpTrib=0`, `MonId='PES'`, `MonCotiz=1`.
- **Reconciliación de centavos**: ajustar el último `Importe`/`ImpIVA` para que se cumpla
  exacto `ImpTotal = ImpNeto + ImpIVA + ImpOpEx`.

Payload `createVoucher` (campos que varían por tipo):
- **B**: `CbteTipo 6`, `DocTipo 99`, `DocNro 0` (o DNI si lo tipean), `CondicionIVAReceptorId 5`.
- **A**: `CbteTipo 1`, `DocTipo 80`, `DocNro = CUIT` (obligatorio, validado 11 dígitos +
  dígito verificador), `CondicionIVAReceptorId` según el cliente (1 RI).
- Comunes: `CantReg 1`, `PtoVta` (config), `Concepto 1`, `CbteDesde=CbteHasta=numero`,
  `CbteFch` (yyyymmdd), importes de arriba, array `Iva`.

## Capa de integración
- `src/lib/afip/client.ts` — instancia `@afipsdk/afip.js` con `{ CUIT, access_token }`
  y flag de entorno; **server-only**. Lee env (`AFIP_ENV`, `AFIP_ACCESS_TOKEN`,
  `AFIP_CUIT`, `AFIP_PTO_VTA`).
- `src/lib/afip/comprobante.ts` — `armarComprobante(venta, tipo, cliente)`: el cálculo
  fiscal de arriba → objeto listo para `createVoucher`.
- `src/lib/afip/qr.ts` — `construirQR({ cuit, ptoVta, tipoCmp, nroCmp, importe, docTipoRec,
  docNroRec, cae })` → payload base64 + URL `https://www.afip.gob.ar/fe/qr/?p=<base64>`.

## Emisión (Server Action)
`src/lib/actions/comprobantes.ts` → `emitirComprobante({ venta_id, tipo, cliente })`:
1. Toma un **lock por (punto_venta, cbte_tipo)** (advisory lock vía RPC) para serializar
   la numeración entre las 2 cajas.
2. Carga la venta + items; arma importes; upsert de la fila `comprobantes` en `pendiente`.
3. `getLastVoucher(ptoVta, cbteTipo)` → `numero = último + 1`; `createVoucher(...)`.
4. Éxito → `emitido` + `cae`, `cae_vto`, `numero`, `qr_payload`, `emitido_en`.
   Falla (AFIP caído / sin internet / rechazo) → `error` + `error_detalle`, `intentos++`.
- **Reintento**: `reintentarComprobante({ comprobante_id })` desde la lista; re-corre 3–4.
- **Recuperación** (anotado, no MVP): si AFIP dio CAE pero se cayó nuestra DB, reconciliar
  con `getVoucherInfo(ptoVta, cbteTipo, numero)`.
- Acciones adicionales de clientes: `buscarClientes(q)`, `crearCliente(...)`,
  `actualizarCliente(...)` (admin).

## Flujo / UX
- **En el cobro** (`caja-cliente.tsx`): tras elegir el pago, paso **opcional**
  `Sin factura` (default) · `Factura B` · `Factura A`. En A: buscador de cliente (por
  CUIT/nombre) con **alta rápida**. Botones grandes, coherente con el POS.
- **Lista de ventas** (`ventas-cliente.tsx`): **todas** las ventas aparecen igual, con una
  **etiqueta de estado fiscal** por fila (`Sin factura` · `B` · `A` · `Pendiente` · `Error`)
  y acción **Facturar** / **Reintentar**.
- **Admin**: pantalla **`/admin/clientes`** (lista + alta/edición).

## Ticket fiscal (replica del Easy POS)
Variante fiscal de `ticket.tsx` (o componente hermano), impresa cuando el comprobante
está `emitido`:
- **Encabezado emisor** (config): `FACTURA A`/`FACTURA B` + `COD.01`/`COD.06`, `Nº PdV-Número`,
  "FACTURA ELECTRONICA", "Lo de Gómez", domicilio (La Sanloreñeña 325, Salta), teléfono,
  **Responsable Inscripto**, CUIT 27288869990, Ing. Brutos, Inicio de actividades, fecha.
- **Cliente**: `C. FINAL` (B) o razón social + CUIT + condición (A).
- **Detalle**: cant. / descripción / importe (como el ticket actual).
- **Total**.
- **B — Régimen de Transparencia Fiscal (Ley 27742)**: `IVA Contenido $` (= IVA calculado)
  y `Otros Impuestos Nacionales Indirectos $` (0).
- **A**: IVA discriminado (neto + IVA por alícuota).
- **CAE** + **Venc.** + **QR** como **SVG inline** (blanco y negro nítido).
- `Sin factura` → ticket común actual ("Ticket no válido como factura").

## Config, entornos y prerequisitos
- Env server-only (Vercel): `AFIP_ENV` (`homologacion`|`produccion`), `AFIP_ACCESS_TOKEN`,
  `AFIP_CUIT`, `AFIP_PTO_VTA`. Datos de display del emisor (razón social, domicilio, IIBB,
  inicio actividades) en config/env.
- Construcción y pruebas en **homologación** con CUIT de prueba `20409378472` (sin certificado).
- **Checklist del dueño (dependencia externa, no la hace Claude):**
  1. Cuenta en app.afipsdk.com → `access_token`.
  2. Certificado digital de AFIP autorizado para el WS de facturación (desde el panel de AFIP SDK).
  3. **Punto de venta**: reutilizar el `0007` (confirmar que es tipo *Web Services* y que
     Easy POS dejó de facturar), o dar de alta uno nuevo si se prefiere.

## Concurrencia y errores
- Numeración serializada por advisory lock (PdV + tipo); ante rechazo de AFIP por número
  usado, reintentar `getLastVoucher`.
- Errores de AFIP (validación, servicio caído, sin internet) → estado `error` con detalle
  legible; el cajero reintenta. La venta y su ticket **no se ven afectados**.
- Doble click / doble emisión bloqueada por el índice único parcial en `venta_id`.
- CUIT de Factura A inválido → mensaje claro, no se llama a AFIP.

## Verificación
- **Unit**: cálculo fiscal (mezclas 21/10,5/exento, redondeo, que cierre `ImpTotal`);
  armado del QR (payload base64 correcto); validación de CUIT.
- **e2e homologación**: emitir B a consumidor final y A con CUIT de prueba → vuelve CAE;
  la fila queda `emitido`; el ticket fiscal renderiza con QR.
- **Impresora real**: confirmar que el QR (SVG) sale nítido en la OCOM POS-80.
- `pnpm exec tsc --noEmit` y `pnpm build` en verde.
