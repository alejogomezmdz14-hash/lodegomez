# CLAUDE.md — Lo De Gómez (Sistema de gestión de kiosco/minimercado)

> Contexto de proyecto para Claude Code. Vive en la raíz del repo.
> Idioma de la UI: **español rioplatense (voseo)**. Cliente: minimercado familiar en Argentina.
> Nombre del proyecto tentativo: "Lo De Gómez" (ajustable).

---

## 1. Qué es

Sistema de gestión integral para el kiosco/minimercado del papá de Alejo. **Reemplaza al sistema viejo (Easy POS, base en DBF)** que hoy se combina con lápiz y papel. Objetivo: una sola herramienta para cobrar, controlar stock, ver métricas, manejar horas de empleados y armar pedidos de reposición.

Es un desarrollo **interno** (no es un producto vendible como Cotizapp). No mezclar con la identidad ni el design system de Cotizapp ni de Gómez Frate Studio.

### Los 6 módulos (orden de construcción = fases)

1. **Base**: migración del catálogo (DBF → Supabase), modelo de datos, auth y roles.
2. **POS / Cobro**: venta, medios de pago, pistola, peso manual, cierre de caja, factura electrónica + ticket, multi-caja, offline.
3. **Dashboard**: ventas totales, productos ganadores/perdedores, por turno, por medio de pago, margen, auditoría.
4. **Facturas por Telegram**: foto → visión IA → revisión → impacta stock + alerta de suba de costo.
5. **Banco de horas**: turnos semanales predefinidos + desvíos.
6. **Reposición**: punto de reposición + faltantes manuales → lista → WhatsApp a los dueños.

Entregar por fases: el papá tiene que empezar a usarlo temprano (aunque sea POS + dashboard) para dejar el papel cuanto antes.

---

## 2. Stack

- **Framework**: Next.js 16 (App Router, Turbopack) + React 19 + TypeScript
- **Formato**: **PWA** (corre igual en la PC del mostrador, tablet y celular)
- **DB**: Supabase (Postgres + RLS). Proyecto Supabase nuevo y dedicado.
- **Auth**: **Supabase Auth** (no Clerk). `auth.uid()` es directamente el UUID del usuario → RLS por rol sin capa intermedia. Sesión vía cookies con `@supabase/ssr` (middleware de refresh). Roles (empleado/admin) en tabla `usuarios` linkeada a `auth.users` y/o custom claim `app_metadata.role`.
- **UI**: Tailwind + shadcn/ui
- **Deploy**: repo en GitHub conectado a Vercel
- **Automatizaciones**: n8n (facturas por Telegram; envío de pedidos por WhatsApp/Evolution API)
- **IA**: OpenAI (visión) para leer facturas de proveedor
- **Fiscal**: intermediario de factura electrónica (propuesto: **TusFacturas**), no integración directa con ARCA al inicio

---

## 3. Arquitectura

### Multi-caja + offline
- **2 cajas** (2 PCs) cobrando en simultáneo.
- **Offline-first para vender**: si se cae internet, la caja **sigue vendiendo** sin comprobante o con **ticket no fiscal**. No todo se factura, así que la caja nunca se frena.
- **La factura electrónica A/B SIEMPRE necesita internet** (el CAE se pide online a ARCA vía intermediario). Si no hay conexión y el cliente pide factura, se emite cuando vuelve la conexión.
- Ventas offline: se guardan localmente (IndexedDB / cola de sincronización en el service worker de la PWA) y se sincronizan al reconectar.
- **Consistencia de stock: eventual.** Con dos cajas offline el stock puede quedar momentáneamente en negativo hasta sincronizar. Es tolerable para este negocio (ya conviven con stock descuadrado hoy).

### Deploy
- Un repo en GitHub → Vercel (flujo estándar de Alejo).

---

## 4. Roles y permisos

### Empleado (limitado)
- Vender.
- **Cierre de caja de su turno** (registra la recaudación de su turno).
- Modificar **precio** y **stock** de productos.
- **Ve el precio de costo.**
- Puede **anular ventas y hacer devoluciones**, PERO:
  - dispara un **aviso a los dueños**, y
  - queda registrado en el **dashboard con número de ticket y hora**.

### Admin (papá, su mujer y una persona más)
- Acceso total (dashboard, costos, reportes, edición de productos, empleados, configuración).
- Ve la **auditoría**: quién y cuándo modificó cada precio/stock (última modificación siempre visible).
- **Ajusta los desvíos del banco de horas** (el empleado no los ajusta).

### Auditoría (transversal)
- Toda modificación de **precio** o **stock** registra `usuario` + `timestamp` + valor anterior/nuevo.
- Toda **anulación/devolución** genera aviso a dueños y entra al dashboard (ticket + hora).

---

## 5. Modelo de datos (fase 1)

Fuente de la carga inicial: `STOCK.DBF` (Easy POS). **4.437 productos.**

### Mapeo DBF → sistema nuevo

| Campo DBF     | Campo nuevo            | Notas |
|---------------|------------------------|-------|
| `CODIGO`      | `codigo`               | EAN-13 en el 84% (matchea con la pistola). El resto son códigos internos alfanuméricos (granel/varios). |
| `DETALLE`     | `descripcion`          | 80 chars. |
| `PRECIOVP`    | `precio_venta`         | **Precio de venta real** (única lista; `PRECIO1..4` y `PRECIOV` están vacíos). |
| `PRECIOC`     | `precio_costo`         | 81% cargado. |
| `GCIA`        | `margen_pct`           | % ganancia (típico 35). |
| `STEXISTEN`   | `stock`                | 835 productos (19%) vienen en **negativo** (ver migración). |
| `RUBRO`       | `rubro`                | 38 rubros; 544 productos sin rubro. |
| `PROVEEDOR`   | `proveedor`            | Vacío en el 86% → se completa solo con las facturas de la fase 4. |

**Ignorar del DBF** (esquema genérico de Easy POS, sin uso real acá): `MARCA`, `MODELO`, `TALLE`, `COLOR`, `TIENDA`, `STINICIAL`, `PRECIO1..4`, `PRECIOV`, `PROVEEDOR1..3`, `PRECOMP1..4`. `FECHA`/`HORA` pueden servir como "última modificación".

### Códigos especiales (venta por peso / unidad suelta)
Ingreso de peso **manual** (la balanza NO está conectada). Códigos ya existentes en el DBF:
- `0` = huevo x unidad · `00` = huevos x 6 · `000` = maple · `0000` = maple oferta
- Fiambrería: `1` = queso · `2` = jamón · `3` = salame (por peso)
- `99` = verdura (genérico). **Verduras por tipo con precio por kg: pendiente, se define más adelante.**

### Tablas núcleo (sketch)
```
productos        (id, codigo, descripcion, rubro, proveedor,
                  precio_costo, precio_venta, margen_pct, iva_pct,
                  stock, stock_minimo, es_pesable, precio_por_kg,
                  modificado_por, modificado_en)

ventas           (id, caja_id, empleado_id, turno_id, fecha_hora,
                  total, medio_pago, comprobante_tipo, comprobante_cae,
                  estado /* activa|anulada|devuelta */, offline_synced)

venta_items      (id, venta_id, producto_id, cantidad, peso_kg,
                  precio_unit, subtotal, iva_pct)

cuentas          (id, tipo /* efectivo|qr|tarjeta|transferencia */, saldo)
movimientos_caja (id, cuenta_id, venta_id, tipo, monto, fecha_hora)

turnos           (id, empleado_id, dia_semana, hora_inicio, hora_fin, horas)
desvios_horas    (id, empleado_id, fecha, horas_reales, motivo, cargado_por_admin)

auditoria        (id, entidad, entidad_id, campo, valor_ant, valor_nuevo,
                  usuario_id, fecha_hora)

eventos_dueños   (id, tipo /* anulacion|devolucion|alerta_precio */,
                  ref_id, ticket_nro, fecha_hora, leido)

proveedor_items  (id, proveedor, texto_factura, producto_id) -- tabla de
                  -- equivalencias que aprende (fase 4)
```

---

## 6. Reglas de negocio

- **Terminología**: siempre "cotización" nunca "presupuesto" (convención global de Alejo). En este proyecto se factura, no se cotiza, pero mantener el criterio si aparece.
- **Una sola lista de precios.**
- **Sin fiado / sin cuenta corriente.** No hay módulo de deudas de clientes.
- **IVA por rubro**: verdura / huevo / pan a 10,5% o exento; el resto 21%. Editable por excepción a nivel producto (`iva_pct`). El DBF no trae IVA, así que se siembra por rubro en la migración.
- **Factura A**: solo si el cliente la pide. **Factura B**: según cliente. Muchas ventas de consumidor final van **sin factura** (variado).
- **Notas de crédito**: las devoluciones de ventas **que sí se facturaron** requieren nota de crédito electrónica (contemplar en el módulo fiscal).
- **Punto de reposición** (`stock_minimo`): editable por producto en el admin. Sembrado por rubro en la migración:
  - Rotación **alta** (cigarrillos, bebidas, golosinas, galletitas, lácteos, snacks, alfajores, chocolates) → **6**
  - Rotación **media** (almacén, fiambrería, perfumería, limpieza, librería) → **3**
  - Rotación **baja** (juguetes, electrónica, varios, sin rubro) → **2**
  - Peso/granel (huevos, fiambre, verdura) → **sin mínimo automático** (a mano).

---

## 7. Integraciones

### Pistola láser (lector de código de barras)
- Funciona como **emulador de teclado (HID keyboard wedge)**: "tipea" el código + Enter. Sin driver ni SDK.
- No conectarse al dispositivo. **Listener global de `keydown`** en la pantalla de cobro (que ande aunque el input pierda foco).
- **Distinguir scan de tipeo manual por timing**: la pistola tira las teclas muy rápido (<30–50 ms entre teclas) y cierra con Enter; una persona escribe lento. El mismo input resuelve EAN scaneado y códigos manuales (0, 00, verduras, etc.).
- Configurar la pistola con **sufijo Enter** (viene así casi siempre).
- No usar WebHID: modo teclado es más simple y confiable para POS.

### Medios de pago / "dónde está la plata"
- Medios: **efectivo, QR (MercadoPago), tarjeta (débito/crédito), transferencia**.
- Al cobrar, el cajero elige el medio → la venta suma a la `cuenta` correspondiente.
- El dashboard muestra **cuánto entró por cada medio** en el turno/día (vista **bruta**, sin comisiones ni acreditación diferida).
- **SIN conciliación con MercadoPago** (esa cuenta tiene demasiados movimientos). Solo el contador por medio.
- Las **transferencias van a otra cuenta bancaria** (destino distinto al de QR).

### Facturas de proveedor → stock (fase 4)
- Canal: **Telegram** (foto de la factura) → n8n → **OpenAI visión** → **pantalla de revisión humana** → impacta stock.
- ~30 proveedores, formatos **variados** (traen descripción, cantidad, precio unitario, total, precio con IVA).
- **Matching híbrido**:
  - Si el renglón trae EAN o código del proveedor → match automático.
  - Si viene solo texto → **tabla de equivalencias (`proveedor_items`) que aprende**: la primera vez se confirma a mano, después reconoce solo.
- **Costo comparado con IVA.**
- **Alerta de suba de precio**: cuando el costo de un ítem sube respecto de la última compra (cualquier suba, no un umbral), avisar **al dashboard**. Solo cuando **sube**.

### Pedidos / reposición (fase 6)
- Híbrido: **stock mínimo automático** (cae bajo `stock_minimo` → entra a la lista) + **carga manual** de faltantes por el empleado.
- La lista final se envía por **WhatsApp a los 2 dueños** (Evolution API), para que revisen. No se manda directo a proveedores.

### Hardware
- **Impresora térmica común 80 mm (ESC/POS)**, sin controlador fiscal.
- Cajón de dinero.
- **Balanza NO conectada**: el peso se ingresa a mano.

---

## 8. Migración desde Easy POS (DBF)

- Fuente: `STOCK.DBF` (FoxBase/dBase III, encoding `latin-1`). 4.437 registros, sin códigos duplicados.
- **Stock negativo en 835 productos (19%)**: el sistema viejo viene descuadrado. Estrategia: **inventario físico de los productos de alta rotación** al migrar; el resto arranca con el stock que trae el DBF. No arrastrar negativos a ciegas.
- **`STMINIMO` viene vacío**: no migrar; sembrar `stock_minimo` por rubro (ver reglas). Más adelante recalcular con el histórico de ventas real del sistema nuevo.
- **`PROVEEDOR` vacío en 86%**: no cargar a mano; se completa con las facturas de la fase 4.
- **544 sin rubro**: clasificar de a poco (no bloquea).
- El sistema viejo **sigue operando** hasta que el nuevo esté andando. Trabajar siempre sobre **copia** del DBF, nunca el original.

---

## 9. Convenciones

- **UI en español rioplatense (voseo)**, sin jerga técnica para el usuario final (el papá y empleados no son técnicos).
- **POS UX**: botones grandes, alto contraste, pensado para touch y para cobrar rápido; el flujo de cobro tiene que ser a prueba de apuro.
- **Design system**: por definir (proyecto interno, no reutiliza paletas de Cotizapp/Gómez Frate Studio).
- Respuestas y mensajes al usuario: directos, sin relleno.
- Auth: **Supabase Auth**; RLS por rol con `auth.uid()` + claim/tabla de rol. (Sin Clerk — decisión revisada.)

---

## 10. Comandos

```bash
pnpm install          # instalar dependencias
pnpm dev              # dev server (Turbopack) en http://localhost:3000
pnpm build            # build de producción
pnpm start            # servir el build
pnpm lint             # ESLint
pnpm exec tsc --noEmit  # typecheck sin emitir
```

- **Package manager**: pnpm.
- **Variables de entorno**: copiar `.env.example` → `.env.local` y completar. `.env.local` no se versiona; `.env.example` sí.
- **Supabase**: URL + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable) van al cliente; `SUPABASE_SERVICE_ROLE_KEY` es secreta y solo server-side.

### Estructura relevante
```
src/lib/supabase/client.ts      # cliente browser (createBrowserClient)
src/lib/supabase/server.ts      # cliente server (createServerClient + cookies)
src/lib/supabase/middleware.ts  # updateSession: refresca la sesión por request
src/middleware.ts               # engancha updateSession en el matcher
```

## 11. Estado actual

- ✅ Relevamiento cerrado (cobro, fiscal, POS, stock, roles, horas, pedidos).
- ✅ `STOCK.DBF` analizado y mapeado.
- ✅ Decisiones de negocio definidas (IVA por rubro, sin fiado, mínimos por rubro, desvíos por admin, verduras pendiente).
- ✅ Proyecto scaffoldeado: Next.js 16 + Tailwind 4 + TS, clientes Supabase (`@supabase/ssr`) cableados y conexión verificada. Auth por **Supabase Auth**.
- ⬜ **Próximo**: shadcn/ui + PWA (manifest/SW), modelo de datos definitivo y migración Fase 1 (DBF + auth/roles). Repo GitHub y deploy Vercel los crea el dueño.
