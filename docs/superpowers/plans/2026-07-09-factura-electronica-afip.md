# Factura electrónica (AFIP SDK) — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Emitir Factura A y B desde el POS vía AFIP SDK (nube), obtener el CAE online, guardar el comprobante y imprimir el ticket fiscal con QR en la térmica.

**Architecture:** La venta se registra como hoy (`registrar_venta`, sin cambios). La facturación es un paso aparte: una Server Action (`emitirComprobante`) lee la venta, arma los importes fiscales (precios con-IVA → neto/IVA/exento), llama a AFIP SDK (`getLastVoucher` + `createVoucher`), guarda una fila en `comprobantes` (estado `pendiente`/`emitido`/`error`) y devuelve los datos para imprimir. Numeración serializada por **reintento ante conflicto** (si AFIP rechaza por número desactualizado, se re-consulta `getLastVoucher` y se reintenta) — más robusto que un lock distribuido dado que la llamada a AFIP es HTTP, no una transacción DB. La lista de clientes (`clientes`) alimenta la Factura A.

**Tech Stack:** Next.js 16 (App Router, Server Actions) · Supabase (Postgres + RLS) · `@afipsdk/afip.js` · `qrcode` · `vitest` (unit de la lógica pura) · Tailwind.

**Nota de entorno:** todo se construye y prueba en **homologación** (AFIP SDK modo dev, CUIT de prueba `20409378472`, sin certificado). El paso a producción es cambiar env (`AFIP_ENV`, `AFIP_ACCESS_TOKEN`, `AFIP_CUIT`, `AFIP_PTO_VTA`).

**Códigos AFIP usados (referencia):**
- `CbteTipo`: 1 = Factura A, 6 = Factura B.
- `DocTipo`: 80 = CUIT, 96 = DNI, 99 = Consumidor Final.
- `CondicionIVAReceptorId`: 1 = Responsable Inscripto, 4 = Exento, 5 = Consumidor Final, 6 = Monotributo.
- `Iva[].Id`: 5 = 21%, 4 = 10,5%. (Exento → no va al array, suma a `ImpOpEx`.)

---

## File Structure

**Nuevos:**
- `src/lib/afip/calculo.ts` — `calcularImportes(items)`: precios con-IVA → `ImportesFiscales`.
- `src/lib/afip/calculo.test.ts` — unit.
- `src/lib/afip/cuit.ts` — `validarCuit(cuit)`.
- `src/lib/afip/cuit.test.ts` — unit.
- `src/lib/afip/qr.ts` — `construirQrPayload(...)`, `qrUrl(payload)`, `qrSvg(url)`.
- `src/lib/afip/qr.test.ts` — unit.
- `src/lib/afip/emisor.ts` — constante con los datos fiscales del emisor.
- `src/lib/afip/client.ts` — instancia AFIP SDK desde env (server-only) + `armarVoucher(...)`.
- `src/lib/actions/clientes.ts` — Server Actions de clientes.
- `src/lib/actions/comprobantes.ts` — `emitirComprobante`, `reintentarComprobante`, `getComprobantePorVenta`.
- `src/app/admin/clientes/page.tsx` + `clientes-cliente.tsx` — pantalla admin de clientes.
- `src/app/(app)/caja/ticket-fiscal.tsx` — ticket fiscal (encabezado + QR).
- `src/app/(app)/caja/factura-paso.tsx` — paso opcional de factura en el cobro.
- `supabase/migrations/0012_fiscal.sql` — tablas `clientes` y `comprobantes` + RLS.

**Modificados:**
- `src/lib/types.ts` — tipos nuevos (`Cliente`, `Comprobante`, `TipoFactura`, etc.).
- `src/app/(app)/caja/caja-cliente.tsx` — enganchar el paso de factura post-venta.
- `src/app/(app)/caja/ventas/ventas-cliente.tsx` — columna de estado fiscal + Facturar/Reintentar.
- `src/app/admin/layout.tsx` — link "Clientes" en el sidebar.
- `package.json` — deps + script `test`.
- `.env.example` — vars `AFIP_*`.

---

## Task 1: Dependencias y test runner

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Instalar dependencias**

Run:
```bash
pnpm add @afipsdk/afip.js qrcode
pnpm add -D vitest @types/qrcode
```

- [ ] **Step 2: Agregar script de test**

En `package.json`, dentro de `"scripts"`, agregar:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Config de vitest**

Crear `vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Verificar que corre (sin tests todavía)**

Run: `pnpm test`
Expected: vitest arranca y reporta "No test files found" (o 0 tests). Sin error de config.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore(fiscal): deps AFIP SDK + qrcode y vitest"
```

---

## Task 2: Cálculo de importes fiscales (TDD)

Convierte los ítems (precio con IVA incluido) en los importes que pide AFIP. Es el corazón fiscal; se prueba a fondo.

**Files:**
- Create: `src/lib/afip/calculo.ts`
- Test: `src/lib/afip/calculo.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Crear `src/lib/afip/calculo.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { calcularImportes } from "./calculo";

describe("calcularImportes", () => {
  it("21%: separa neto e IVA de un precio con IVA incluido", () => {
    const r = calcularImportes([{ subtotal: 121, iva_pct: 21 }]);
    expect(r.total).toBe(121);
    expect(r.neto).toBe(100);
    expect(r.iva).toBe(21);
    expect(r.exento).toBe(0);
    expect(r.iva_items).toEqual([{ Id: 5, BaseImp: 100, Importe: 21 }]);
  });

  it("mezcla 21% y 10,5% en dos entradas de IVA", () => {
    const r = calcularImportes([
      { subtotal: 121, iva_pct: 21 },
      { subtotal: 110.5, iva_pct: 10.5 },
    ]);
    expect(r.total).toBe(231.5);
    expect(r.neto).toBe(200);
    expect(r.iva).toBe(31.5);
    expect(r.iva_items).toEqual([
      { Id: 5, BaseImp: 100, Importe: 21 },
      { Id: 4, BaseImp: 100, Importe: 10.5 },
    ]);
  });

  it("exento va a ImpOpEx y no al array de IVA", () => {
    const r = calcularImportes([
      { subtotal: 121, iva_pct: 21 },
      { subtotal: 50, iva_pct: 0 },
    ]);
    expect(r.total).toBe(171);
    expect(r.neto).toBe(100);
    expect(r.iva).toBe(21);
    expect(r.exento).toBe(50);
    expect(r.iva_items).toEqual([{ Id: 5, BaseImp: 100, Importe: 21 }]);
  });

  it("reconcilia centavos: total = neto + iva + exento exacto", () => {
    const r = calcularImportes([
      { subtotal: 100, iva_pct: 21 },
      { subtotal: 100, iva_pct: 21 },
      { subtotal: 33.33, iva_pct: 21 },
    ]);
    expect(r.total).toBe(233.33);
    expect(r.neto + r.iva + r.exento).toBeCloseTo(233.33, 2);
    expect(r.iva_items[0].BaseImp + r.iva_items[0].Importe).toBeCloseTo(233.33, 2);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm test src/lib/afip/calculo.test.ts`
Expected: FAIL — "Failed to resolve import './calculo'".

- [ ] **Step 3: Implementación mínima**

Crear `src/lib/afip/calculo.ts`:
```ts
// Convierte ítems con precio con-IVA incluido a los importes que pide AFIP.
// Id de alícuota AFIP: 21% → 5, 10,5% → 4. Exento (0) → ImpOpEx.
const IVA_ID: Record<number, number> = { 21: 5, 10.5: 4 };

export type IvaItem = { Id: number; BaseImp: number; Importe: number };
export type ImportesFiscales = {
  total: number;
  neto: number;
  iva: number;
  exento: number;
  iva_items: IvaItem[];
};

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function calcularImportes(
  items: { subtotal: number; iva_pct: number }[],
): ImportesFiscales {
  // Bruto (con IVA) agrupado por alícuota, en el orden 21 → 10,5.
  const porAlic = new Map<number, number>();
  let exento = 0;
  for (const it of items) {
    const pct = Number(it.iva_pct);
    if (!IVA_ID[pct]) {
      exento = r2(exento + it.subtotal);
      continue;
    }
    porAlic.set(pct, r2((porAlic.get(pct) ?? 0) + it.subtotal));
  }

  const iva_items: IvaItem[] = [];
  let neto = 0;
  let iva = 0;
  for (const pct of [21, 10.5]) {
    const bruto = porAlic.get(pct);
    if (!bruto) continue;
    const base = r2(bruto / (1 + pct / 100));
    const imp = r2(bruto - base);
    iva_items.push({ Id: IVA_ID[pct], BaseImp: base, Importe: imp });
    neto = r2(neto + base);
    iva = r2(iva + imp);
  }

  const total = r2(items.reduce((s, it) => s + it.subtotal, 0));
  // Reconciliación: el total debe cerrar exacto. Ajustar el último Importe/iva.
  const dif = r2(total - neto - iva - exento);
  if (dif !== 0 && iva_items.length > 0) {
    const last = iva_items[iva_items.length - 1];
    last.Importe = r2(last.Importe + dif);
    iva = r2(iva + dif);
  }

  return { total, neto, iva, exento, iva_items };
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `pnpm test src/lib/afip/calculo.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/afip/calculo.ts src/lib/afip/calculo.test.ts
git commit -m "feat(fiscal): calculo de importes (precio con-IVA a neto/IVA/exento)"
```

---

## Task 3: Validación de CUIT (TDD)

**Files:**
- Create: `src/lib/afip/cuit.ts`
- Test: `src/lib/afip/cuit.test.ts`

- [ ] **Step 1: Test que falla**

Crear `src/lib/afip/cuit.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validarCuit } from "./cuit";

describe("validarCuit", () => {
  it("acepta un CUIT válido (con y sin guiones)", () => {
    expect(validarCuit("27288869990")).toBe(true);
    expect(validarCuit("27-28886999-0")).toBe(true);
  });
  it("rechaza dígito verificador incorrecto", () => {
    expect(validarCuit("27288869991")).toBe(false);
  });
  it("rechaza longitud incorrecta o no numérico", () => {
    expect(validarCuit("123")).toBe(false);
    expect(validarCuit("abcdefghijk")).toBe(false);
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm test src/lib/afip/cuit.test.ts`
Expected: FAIL — no existe `./cuit`.

- [ ] **Step 3: Implementación**

Crear `src/lib/afip/cuit.ts`:
```ts
// Valida CUIT/CUIL argentino (11 dígitos, dígito verificador mód 11).
export function validarCuit(cuit: string): boolean {
  const s = (cuit ?? "").replace(/\D/g, "");
  if (s.length !== 11) return false;
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const nums = s.split("").map(Number);
  const suma = pesos.reduce((acc, p, i) => acc + p * nums[i], 0);
  let dv = 11 - (suma % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === nums[10];
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `pnpm test src/lib/afip/cuit.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/afip/cuit.ts src/lib/afip/cuit.test.ts
git commit -m "feat(fiscal): validacion de CUIT (mod 11)"
```

---

## Task 4: QR de AFIP (TDD)

**Files:**
- Create: `src/lib/afip/qr.ts`
- Test: `src/lib/afip/qr.test.ts`

- [ ] **Step 1: Test que falla**

Crear `src/lib/afip/qr.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { construirQrPayload, qrUrl } from "./qr";

function decode(p: string) {
  return JSON.parse(Buffer.from(p, "base64").toString("utf8"));
}

describe("QR de AFIP", () => {
  it("consumidor final: omite tipoDocRec/nroDocRec (son 'de corresponder')", () => {
    const obj = decode(
      construirQrPayload({
        fecha: "2026-07-08",
        cuit: 27288869990,
        ptoVta: 7,
        tipoCmp: 6,
        nroCmp: 21608,
        importe: 20100,
        docTipoRec: 99,
        docNroRec: 0,
        cae: "86273030548980",
      }),
    );
    expect(obj).toMatchObject({
      ver: 1,
      fecha: "2026-07-08",
      cuit: 27288869990,
      ptoVta: 7,
      tipoCmp: 6,
      nroCmp: 21608,
      importe: 20100,
      moneda: "PES",
      ctz: 1,
      tipoCodAut: "E",
      codAut: 86273030548980,
    });
    expect(obj.tipoDocRec).toBeUndefined();
    expect(obj.nroDocRec).toBeUndefined();
  });

  it("receptor identificado (Factura A): incluye tipoDocRec/nroDocRec", () => {
    const obj = decode(
      construirQrPayload({
        fecha: "2026-07-08",
        cuit: 27288869990,
        ptoVta: 7,
        tipoCmp: 1,
        nroCmp: 55,
        importe: 12100,
        docTipoRec: 80,
        docNroRec: 30111222223,
        cae: "12345678901234",
      }),
    );
    expect(obj.tipoDocRec).toBe(80);
    expect(obj.nroDocRec).toBe(30111222223);
  });

  it("qrUrl usa el dominio oficial de AFIP", () => {
    expect(qrUrl("ABC")).toBe("https://www.afip.gob.ar/fe/qr/?p=ABC");
  });
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `pnpm test src/lib/afip/qr.test.ts`
Expected: FAIL — no existe `./qr`.

- [ ] **Step 3: Implementación**

Crear `src/lib/afip/qr.ts`:
```ts
import QRCode from "qrcode";

// Datos del QR según RG AFIP. Ver https://www.afip.gob.ar/fe/qr/documentos/QRespecificaciones.pdf
export type DatosQr = {
  fecha: string; // yyyy-mm-dd
  cuit: number; // emisor
  ptoVta: number;
  tipoCmp: number; // 1 A, 6 B
  nroCmp: number;
  importe: number;
  docTipoRec?: number; // omitir para consumidor final (DocTipo 99)
  docNroRec?: number;
  cae: string;
};

export function construirQrPayload(d: DatosQr): string {
  const obj: Record<string, unknown> = {
    ver: 1,
    fecha: d.fecha,
    cuit: d.cuit,
    ptoVta: d.ptoVta,
    tipoCmp: d.tipoCmp,
    nroCmp: d.nroCmp,
    importe: d.importe,
    moneda: "PES",
    ctz: 1,
  };
  // tipoDocRec/nroDocRec son "de corresponder": solo si el receptor está
  // identificado (Factura A). Para consumidor final (99/0) se omiten.
  if (d.docTipoRec && d.docTipoRec !== 99 && d.docNroRec && d.docNroRec > 0) {
    obj.tipoDocRec = d.docTipoRec;
    obj.nroDocRec = d.docNroRec;
  }
  obj.tipoCodAut = "E";
  obj.codAut = Number(d.cae);
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

export function qrUrl(payloadBase64: string): string {
  return `https://www.afip.gob.ar/fe/qr/?p=${payloadBase64}`;
}

// SVG del QR (vector, blanco y negro nítido para la térmica).
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `pnpm test src/lib/afip/qr.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/afip/qr.ts src/lib/afip/qr.test.ts
git commit -m "feat(fiscal): payload y SVG del QR de AFIP"
```

---

## Task 5: Migración SQL (clientes + comprobantes)

**Files:**
- Create: `supabase/migrations/0012_fiscal.sql`

- [ ] **Step 1: Escribir la migración**

Crear `supabase/migrations/0012_fiscal.sql` (idempotente, estilo de las anteriores):
```sql
-- ============================================================================
-- Fase fiscal — clientes y comprobantes (factura electronica AFIP).
-- Escritura desde el server (service_role) o RPC; lectura para usuarios.
-- ============================================================================

-- trigger genérico de actualizado_en (reutilizable)
create or replace function public.set_actualizado_en()
returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end $$;

-- === clientes ===
create table if not exists public.clientes (
  id             uuid primary key default gen_random_uuid(),
  doc_tipo       int  not null default 80,   -- 80 CUIT | 96 DNI | 86 CUIL
  doc_nro        text not null,
  razon_social   text not null,
  domicilio      text,
  cond_iva       int  not null default 1,    -- 1 RI | 6 Monotributo | 4 Exento | 5 CF
  email          text,
  telefono       text,
  creado_por     uuid references public.usuarios (id) on delete set null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create unique index if not exists clientes_doc_idx on public.clientes (doc_tipo, doc_nro);
alter table public.clientes enable row level security;

drop trigger if exists clientes_set_actualizado on public.clientes;
create trigger clientes_set_actualizado before update on public.clientes
  for each row execute function public.set_actualizado_en();

drop policy if exists clientes_select on public.clientes;
create policy clientes_select on public.clientes
  for select to authenticated using (public.es_usuario());

-- === comprobantes ===
create table if not exists public.comprobantes (
  id                uuid primary key default gen_random_uuid(),
  venta_id          uuid not null references public.ventas (id) on delete cascade,
  tipo              text not null,             -- 'A' | 'B'
  cbte_tipo         int  not null,             -- 1 | 6
  punto_venta       int  not null,
  numero            bigint,                    -- lo asigna AFIP; null hasta emitir
  cliente_id        uuid references public.clientes (id) on delete set null,
  doc_tipo          int  not null,             -- 99 | 80 | 96
  doc_nro           text not null default '0',
  cond_iva_receptor int  not null,             -- 5 CF | 1 RI
  cliente_nombre    text,
  neto              numeric(12,2) not null,
  iva               numeric(12,2) not null,
  exento            numeric(12,2) not null default 0,
  total             numeric(12,2) not null,
  cae               text,
  cae_vto           date,
  qr_payload        text,
  estado            text not null default 'pendiente',  -- pendiente | emitido | error
  error_detalle     text,
  intentos          int not null default 0,
  emitido_por       uuid references public.usuarios (id) on delete set null,
  emitido_en        timestamptz,
  creado_en         timestamptz not null default now()
);
-- Una venta no se factura dos veces (salvo que quede en error → se reintenta).
create unique index if not exists comprobantes_venta_activo_idx
  on public.comprobantes (venta_id) where estado in ('pendiente','emitido');
create index if not exists comprobantes_estado_idx on public.comprobantes (estado);
alter table public.comprobantes enable row level security;

drop policy if exists comprobantes_select on public.comprobantes;
create policy comprobantes_select on public.comprobantes
  for select to authenticated using (public.es_usuario());
```

- [ ] **Step 2: Aplicar la migración**

Correr el contenido de `0012_fiscal.sql` en el **SQL Editor de Supabase** (como las 0001–0011).
Expected: "Success. No rows returned". Verificar en Table Editor que existen `clientes` y `comprobantes`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0012_fiscal.sql
git commit -m "feat(fiscal): tablas clientes y comprobantes + RLS"
```

---

## Task 6: Tipos del dominio

**Files:**
- Modify: `src/lib/types.ts` (agregar al final)

- [ ] **Step 1: Agregar tipos**

Al final de `src/lib/types.ts`:
```ts
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
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(fiscal): tipos Cliente/Comprobante/estado fiscal"
```

---

## Task 7: Config del emisor + cliente AFIP + armado del voucher

**Files:**
- Create: `src/lib/afip/emisor.ts`, `src/lib/afip/client.ts`
- Modify: `.env.example`

- [ ] **Step 1: Datos del emisor**

Crear `src/lib/afip/emisor.ts`:
```ts
// Datos fiscales del emisor (Lo de Gómez, Responsable Inscripto).
// El CUIT y el punto de venta se leen de env (varían homologación/producción).
export const EMISOR = {
  razonSocial: "Lo de Gómez",
  domicilio: "La Sanloreñeña 325",
  localidad: "Salta",
  telefono: "3875330505",
  condicion: "Responsable Inscripto",
  cuit: process.env.AFIP_CUIT ?? "20409378472",
  ingresosBrutos: "27288869990",
  inicioActividades: "08/2024",
  puntoVenta: Number(process.env.AFIP_PTO_VTA ?? "1"),
};
```

- [ ] **Step 2: Cliente AFIP + armado del voucher**

Crear `src/lib/afip/client.ts`:
```ts
import "server-only";
import Afip from "@afipsdk/afip.js";
import { calcularImportes } from "./calculo";
import type { CartItem, TipoFactura } from "@/lib/types";

// Instancia de AFIP SDK. Homologación (por defecto): solo { CUIT, access_token }
// (el CUIT de prueba 20409378472 no requiere certificado). Producción: además
// cert + key (PEM autorizado) y production: true.
export function getAfip(): Afip {
  const cfg: Record<string, unknown> = {
    CUIT: Number(process.env.AFIP_CUIT ?? "20409378472"),
    access_token: process.env.AFIP_ACCESS_TOKEN,
  };
  if (process.env.AFIP_ENV === "produccion") {
    cfg.cert = process.env.AFIP_CERT;
    cfg.key = process.env.AFIP_KEY;
    cfg.production = true;
  }
  return new Afip(cfg);
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
```

- [ ] **Step 3: Documentar env**

En `.env.example`, agregar:
```
# AFIP SDK (factura electrónica). Homologación por defecto.
AFIP_ENV=homologacion
AFIP_ACCESS_TOKEN=
AFIP_CUIT=20409378472
AFIP_PTO_VTA=1
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/lib/afip/emisor.ts src/lib/afip/client.ts .env.example
git commit -m "feat(fiscal): cliente AFIP SDK, emisor y armado del voucher"
```

---

## Task 8: Server Actions de clientes

**Files:**
- Create: `src/lib/actions/clientes.ts`

- [ ] **Step 1: Implementar**

Crear `src/lib/actions/clientes.ts`:
```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getUsuarioActual, requireAdmin } from "@/lib/auth";
import { validarCuit } from "@/lib/afip/cuit";
import type { Cliente } from "@/lib/types";

export type ResultadoCliente =
  | { ok: true; cliente: Cliente }
  | { ok: false; error: string };

const COLS =
  "id,doc_tipo,doc_nro,razon_social,domicilio,cond_iva,email,telefono,creado_en";

// Busca clientes por razón social o número de documento (para el POS y el admin).
export async function buscarClientes(q: string): Promise<Cliente[]> {
  const u = await getUsuarioActual();
  if (!u) return [];
  const admin = createAdminClient();
  const term = q.trim();
  let query = admin.from("clientes").select(COLS).order("razon_social").limit(20);
  if (term) query = query.or(`razon_social.ilike.%${term}%,doc_nro.ilike.%${term}%`);
  const { data } = await query;
  return (data as Cliente[] | null) ?? [];
}

export async function listarClientes(): Promise<Cliente[]> {
  await requireAdmin();
  const admin = createAdminClient();
  const { data } = await admin.from("clientes").select(COLS).order("razon_social");
  return (data as Cliente[] | null) ?? [];
}

export type ClienteInput = {
  doc_tipo: number;
  doc_nro: string;
  razon_social: string;
  domicilio?: string;
  cond_iva: number;
  email?: string;
  telefono?: string;
};

function validar(input: ClienteInput): string | null {
  if (!input.razon_social.trim()) return "Falta la razón social.";
  const doc = input.doc_nro.replace(/\D/g, "");
  if (input.doc_tipo === 80 && !validarCuit(doc)) return "CUIT inválido.";
  if (input.doc_tipo === 96 && (doc.length < 7 || doc.length > 8)) return "DNI inválido.";
  return null;
}

// Alta de cliente (empleado o admin: se usa en el POS para Factura A).
export async function crearCliente(input: ClienteInput): Promise<ResultadoCliente> {
  const u = await getUsuarioActual();
  if (!u) return { ok: false, error: "No autorizado" };
  const err = validar(input);
  if (err) return { ok: false, error: err };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clientes")
    .insert({
      doc_tipo: input.doc_tipo,
      doc_nro: input.doc_nro.replace(/\D/g, ""),
      razon_social: input.razon_social.trim(),
      domicilio: input.domicilio?.trim() || null,
      cond_iva: input.cond_iva,
      email: input.email?.trim() || null,
      telefono: input.telefono?.trim() || null,
      creado_por: u.id,
    })
    .select(COLS)
    .single();
  if (error) {
    const msg = /duplicate|unique/i.test(error.message)
      ? "Ya existe un cliente con ese documento."
      : error.message;
    return { ok: false, error: msg };
  }
  return { ok: true, cliente: data as Cliente };
}

// Edición (solo admin).
export async function actualizarCliente(
  id: string,
  input: ClienteInput,
): Promise<ResultadoCliente> {
  await requireAdmin();
  const err = validar(input);
  if (err) return { ok: false, error: err };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clientes")
    .update({
      doc_tipo: input.doc_tipo,
      doc_nro: input.doc_nro.replace(/\D/g, ""),
      razon_social: input.razon_social.trim(),
      domicilio: input.domicilio?.trim() || null,
      cond_iva: input.cond_iva,
      email: input.email?.trim() || null,
      telefono: input.telefono?.trim() || null,
    })
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, cliente: data as Cliente };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/clientes.ts
git commit -m "feat(fiscal): server actions de clientes (buscar/crear/editar)"
```

---

## Task 9: Server Action de emisión

Corazón del flujo. Lee la venta, arma el voucher, llama a AFIP con reintento ante conflicto de numeración, guarda el comprobante y devuelve los datos para imprimir (incluye el SVG del QR).

**Files:**
- Create: `src/lib/actions/comprobantes.ts`

- [ ] **Step 1: Implementar**

Crear `src/lib/actions/comprobantes.ts`:
```ts
"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getUsuarioActual } from "@/lib/auth";
import { getAfip, armarVoucher, type ReceptorVoucher } from "@/lib/afip/client";
import { EMISOR } from "@/lib/afip/emisor";
import { construirQrPayload, qrUrl, qrSvg } from "@/lib/afip/qr";
import type { Comprobante, TipoFactura } from "@/lib/types";

export type DatosFactura = {
  venta_id: string;
  tipo: TipoFactura;
  cliente_id?: string | null; // requerido para A
};

export type ComprobanteImpresion = {
  comprobante: Comprobante;
  qr_svg: string;
};

export type ResultadoComprobante =
  | { ok: true; data: ComprobanteImpresion }
  | { ok: false; error: string };

const COMP_COLS =
  "id,venta_id,tipo,cbte_tipo,punto_venta,numero,cliente_id,doc_tipo,doc_nro," +
  "cond_iva_receptor,cliente_nombre,neto,iva,exento,total,cae,cae_vto,qr_payload," +
  "estado,error_detalle,emitido_en";

// Emite (o reemite) una factura para una venta.
export async function emitirComprobante(
  datos: DatosFactura,
): Promise<ResultadoComprobante> {
  const u = await getUsuarioActual();
  if (!u) return { ok: false, error: "No autorizado" };

  const admin = createAdminClient();

  // Idempotencia: si ya hay uno emitido/pendiente, no duplicar.
  const { data: existente } = await admin
    .from("comprobantes")
    .select(COMP_COLS)
    .eq("venta_id", datos.venta_id)
    .in("estado", ["emitido", "pendiente"])
    .maybeSingle();
  if (existente && existente.estado === "emitido") {
    return { ok: false, error: "Esta venta ya está facturada." };
  }

  // Venta + items.
  const { data: venta } = await admin
    .from("ventas")
    .select("id,total,creada_en")
    .eq("id", datos.venta_id)
    .single();
  if (!venta) return { ok: false, error: "No existe la venta." };
  const { data: items } = await admin
    .from("venta_items")
    .select("subtotal,iva_pct")
    .eq("venta_id", datos.venta_id);
  if (!items || items.length === 0) return { ok: false, error: "La venta no tiene ítems." };

  // Receptor.
  let receptor: ReceptorVoucher;
  let clienteNombre: string | null = null;
  if (datos.tipo === "A") {
    if (!datos.cliente_id) return { ok: false, error: "La Factura A necesita un cliente." };
    const { data: cli } = await admin
      .from("clientes")
      .select("doc_tipo,doc_nro,razon_social,cond_iva")
      .eq("id", datos.cliente_id)
      .single();
    if (!cli) return { ok: false, error: "No existe el cliente." };
    receptor = { docTipo: cli.doc_tipo, docNro: Number(cli.doc_nro), condIva: cli.cond_iva };
    clienteNombre = cli.razon_social;
  } else {
    receptor = { docTipo: 99, docNro: 0, condIva: 5 }; // B a consumidor final
  }

  const puntoVenta = EMISOR.puntoVenta;
  const cbteTipo = datos.tipo === "A" ? 1 : 6;
  const itemsFiscales = items.map((it) => ({
    subtotal: Number(it.subtotal),
    iva_pct: Number(it.iva_pct),
  }));

  const afip = getAfip();

  // Emitir con reintento ante conflicto de numeración (dos cajas simultáneas).
  let cae = "";
  let caeVto = "";
  let numero = 0;
  let importes = armarVoucher({ tipo: datos.tipo, puntoVenta, numero: 1, receptor, items: itemsFiscales }).importes;
  let ultimoError = "";
  for (let intento = 0; intento < 3; intento++) {
    try {
      const last: number = await afip.ElectronicBilling.getLastVoucher(puntoVenta, cbteTipo);
      numero = Number(last) + 1;
      const armado = armarVoucher({ tipo: datos.tipo, puntoVenta, numero, receptor, items: itemsFiscales });
      importes = armado.importes;
      const res = await afip.ElectronicBilling.createVoucher(armado.voucher);
      cae = res.CAE;
      caeVto = res.CAEFchVto; // yyyy-mm-dd
      break;
    } catch (e) {
      ultimoError = e instanceof Error ? e.message : String(e);
      // Si es conflicto de numeración, reintentar; si no, cortar.
      if (!/n.mero|number|10016|no se corresponde/i.test(ultimoError)) break;
    }
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

  if (!cae) {
    // Falla → guardar/actualizar en estado error para reintentar después.
    await upsertComprobante(admin, existente?.id, {
      ...base,
      estado: "error",
      error_detalle: ultimoError || "No se pudo emitir",
      intentos: (existenteIntentos(existente) ?? 0) + 1,
    });
    return { ok: false, error: `AFIP: ${ultimoError || "no se pudo emitir"}` };
  }

  // Éxito → armar QR y guardar emitido.
  const fecha = new Date(venta.creada_en).toISOString().slice(0, 10);
  const qrPayload = construirQrPayload({
    fecha,
    cuit: Number(EMISOR.cuit),
    ptoVta: puntoVenta,
    tipoCmp: cbteTipo,
    nroCmp: numero,
    importe: importes.total,
    docTipoRec: receptor.docTipo,
    docNroRec: receptor.docNro,
    cae,
  });

  const { data: guardado, error: eGuardar } = await upsertComprobante(admin, existente?.id, {
    ...base,
    numero,
    cae,
    cae_vto: caeVto,
    qr_payload: qrPayload,
    estado: "emitido",
    error_detalle: null,
    emitido_en: new Date().toISOString(),
  });
  if (eGuardar || !guardado) {
    return { ok: false, error: "Se emitió en AFIP pero falló el guardado. Revisá la venta." };
  }

  const svg = await qrSvg(qrUrl(qrPayload));
  return { ok: true, data: { comprobante: guardado as Comprobante, qr_svg: svg } };
}

function existenteIntentos(existente: { estado?: string } | null): number | null {
  return existente ? 0 : null; // el intentos real vive en DB; simplificado para el MVP
}

async function upsertComprobante(
  admin: ReturnType<typeof createAdminClient>,
  id: string | undefined,
  fields: Record<string, unknown>,
) {
  if (id) {
    return admin.from("comprobantes").update(fields).eq("id", id).select(COMP_COLS).single();
  }
  return admin.from("comprobantes").insert(fields).select(COMP_COLS).single();
}

// Reintenta un comprobante que quedó en error.
export async function reintentarComprobante(ventaId: string, tipo: TipoFactura, clienteId?: string) {
  return emitirComprobante({ venta_id: ventaId, tipo, cliente_id: clienteId });
}

// Estado fiscal de una lista de ventas (para la pantalla de ventas).
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
    map[c.venta_id as string] = { estado: c.estado as string, tipo: c.tipo as string };
  }
  return map;
}
```

> Nota: `existenteIntentos` está simplificado para el MVP (el contador `intentos` de la tabla no se re-lee). Si más adelante querés límite de reintentos, leé `intentos` en el SELECT inicial y sumá.

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: sin errores. (Si TS se queja del tipo de retorno de `getLastVoucher`, castear a `number`.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/comprobantes.ts
git commit -m "feat(fiscal): server action de emision (CAE + QR + estados)"
```

---

## Task 10: Ticket fiscal (con QR)

**Files:**
- Create: `src/app/(app)/caja/ticket-fiscal.tsx`

- [ ] **Step 1: Componente**

Crear `src/app/(app)/caja/ticket-fiscal.tsx`:
```tsx
import { pesos, cantidadStr } from "@/lib/formato";
import { EMISOR } from "@/lib/afip/emisor";
import type { Comprobante, TicketItem } from "@/lib/types";

// Ticket fiscal 80mm (Factura A/B). Réplica del comprobante de Easy POS.
// Oculto en pantalla; visible solo al imprimir (mismas reglas que Ticket).
export function TicketFiscal({
  comprobante,
  items,
  qrSvg,
}: {
  comprobante: Comprobante | null;
  items: TicketItem[];
  qrSvg: string | null;
}) {
  if (!comprobante || comprobante.estado !== "emitido") return null;
  const c = comprobante;
  const nro = `${String(c.punto_venta).padStart(4, "0")}-${String(c.numero ?? 0).padStart(8, "0")}`;
  const cod = c.tipo === "A" ? "COD.01" : "COD.06";

  return (
    <div className="hidden print:block">
      <div className="mx-auto w-[72mm] px-1 py-2 text-[11px] leading-tight text-black">
        <div className="flex flex-col items-center gap-0.5">
          <span className="text-2xl font-black leading-none">{c.tipo}</span>
          <span className="text-[10px]">{cod}</span>
          <span className="mt-1 font-semibold">FACTURA ELECTRÓNICA</span>
          <span>Nº {nro}</span>
        </div>

        <div className="my-2 border-t border-dashed border-black" />
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-bold">{EMISOR.razonSocial}</span>
          <span>{EMISOR.domicilio}</span>
          <span>{EMISOR.localidad}</span>
          <span>{EMISOR.telefono}</span>
          <span className="mt-1">{EMISOR.condicion}</span>
          <span>CUIT {EMISOR.cuit}</span>
          <span>Ing. Brutos {EMISOR.ingresosBrutos}</span>
          <span>In. Act. {EMISOR.inicioActividades}</span>
        </div>

        <div className="my-2 border-t border-dashed border-black" />
        <span>
          Cliente:{" "}
          {c.tipo === "B" ? "C. FINAL" : `${c.cliente_nombre ?? ""} (CUIT ${c.doc_nro})`}
        </span>

        <div className="my-2 border-t border-dashed border-black" />
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left">
              <th>Cant.</th>
              <th>Detalle</th>
              <th className="text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i}>
                <td className="align-top tabular-nums">
                  {it.es_pesable ? `${cantidadStr(it.cantidad)}` : it.cantidad.toFixed(3)}
                </td>
                <td className="align-top">{it.descripcion}</td>
                <td className="text-right align-top tabular-nums">{pesos(it.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="my-2 border-t border-dashed border-black" />
        <div className="flex justify-between text-base font-bold">
          <span>Total</span>
          <span className="tabular-nums">{pesos(c.total)}</span>
        </div>

        {c.tipo === "B" ? (
          <div className="mt-2 flex flex-col gap-0.5 text-[10px]">
            <span>Régimen de Transparencia Fiscal a Consumidor Final (Ley 27.742)</span>
            <div className="flex justify-between">
              <span>IVA Contenido $</span>
              <span className="tabular-nums">{pesos(c.iva)}</span>
            </div>
            <div className="flex justify-between">
              <span>Otros Impuestos Nacionales Indirectos $</span>
              <span className="tabular-nums">{pesos(0)}</span>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-0.5 text-[10px]">
            <div className="flex justify-between">
              <span>Neto Gravado $</span>
              <span className="tabular-nums">{pesos(c.neto)}</span>
            </div>
            <div className="flex justify-between">
              <span>IVA $</span>
              <span className="tabular-nums">{pesos(c.iva)}</span>
            </div>
          </div>
        )}

        <div className="my-2 border-t border-dashed border-black" />
        <div className="flex flex-col gap-0.5">
          <span>CAE {c.cae}</span>
          <span>Vto. {c.cae_vto}</span>
        </div>
        {qrSvg ? (
          <div
            className="mx-auto mt-2 w-[35mm]"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : null}
        <p className="mt-2 text-center text-[10px]">¡Gracias por tu compra!</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/caja/ticket-fiscal.tsx"
git commit -m "feat(fiscal): ticket fiscal con QR y transparencia Ley 27742"
```

---

## Task 11: Paso de factura en el cobro

Componente que, tras cobrar, ofrece `Sin factura` / `B` / `A`. Para A: buscar cliente o alta rápida.

**Files:**
- Create: `src/app/(app)/caja/factura-paso.tsx`
- Modify: `src/app/(app)/caja/caja-cliente.tsx`

- [ ] **Step 1: Componente del paso de factura**

Crear `src/app/(app)/caja/factura-paso.tsx`:
```tsx
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
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => setAbierto(true)}>
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
```

- [ ] **Step 2: Enganchar en el cobro**

En `src/app/(app)/caja/caja-cliente.tsx`:

(a) Import al inicio:
```tsx
import { FacturaPaso } from "./factura-paso";
import { TicketFiscal } from "./ticket-fiscal";
import type { ComprobanteImpresion } from "@/lib/actions/comprobantes";
```

(b) Estado nuevo (junto a `const [ticket, setTicket] = ...`):
```tsx
const [ventaAFacturar, setVentaAFacturar] = useState<string | null>(null);
const [fiscal, setFiscal] = useState<ComprobanteImpresion | null>(null);
```

(c) En `cobrar()`, después de `setTicket(res.venta);`, ofrecer facturar (no imprime todavía el común si va a facturar). Reemplazar el bloque final de `cobrar()` (desde `setTicket(res.venta);` hasta `foco();`) por:
```tsx
    setTicket(res.venta);
    if (res.venta.items.length !== items.length) {
      toast.warning("Ojo: algunos ítems no se registraron. Revisá el ticket.");
    }
    toast.success(`Venta #${res.venta.ticket_nro} — ${pesos(res.venta.total)}`);
    setVentaAFacturar(res.venta.id); // abre el paso de factura
    setItems([]);
    resetPago();
    foco();
```

(d) El `useEffect` que imprime el ticket común: que NO imprima mientras está abierto el paso de factura. Cambiar:
```tsx
  useEffect(() => {
    if (!ticket) return;
    if (ventaAFacturar) return; // esperando decisión de factura
    imprimirTicket();
  }, [ticket, ventaAFacturar]);
```

(e) Imprimir el ticket fiscal cuando se emite:
```tsx
  useEffect(() => {
    if (!fiscal) return;
    imprimirTicket();
  }, [fiscal]);
```

(f) En el JSX, antes de `<Ticket venta={ticket} />`, renderizar el panel de factura y el ticket fiscal:
```tsx
      {ventaAFacturar ? (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background p-4 shadow-lg print:hidden">
          <div className="mx-auto max-w-md">
            <FacturaPaso
              ventaId={ventaAFacturar}
              onSaltar={() => {
                setVentaAFacturar(null);
                imprimirTicket(); // imprime el ticket común
              }}
              onListo={(data) => {
                setVentaAFacturar(null);
                setTicket(null); // el fiscal reemplaza al común
                setFiscal(data);
              }}
            />
          </div>
        </div>
      ) : null}

      <TicketFiscal
        comprobante={fiscal?.comprobante ?? null}
        items={ticket?.items ?? []}
        qrSvg={fiscal?.qr_svg ?? null}
      />
```

> Nota: `TicketFiscal` usa `ticket.items` (el mismo detalle de la venta). Como al emitir hacemos `setTicket(null)`, guardá los items antes. Ajuste: en `onListo`, en vez de `setTicket(null)`, dejá `ticket` como está (el `<Ticket>` común no imprime porque el `useEffect` ya no dispara: `fiscal` dispara su propio print y `<Ticket>` solo se ve si se llama `imprimirTicket` con `ticket` presente). Para evitar imprimir los dos, hacé que `<Ticket>` reciba `venta={fiscal ? null : ticket}`.

Cambiar la última línea del JSX:
```tsx
      <Ticket venta={fiscal ? null : ticket} />
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/caja/factura-paso.tsx" "src/app/(app)/caja/caja-cliente.tsx"
git commit -m "feat(fiscal): paso opcional de factura en el cobro (B/A + cliente)"
```

---

## Task 12: Estado fiscal + facturar/reintentar en la lista de ventas

**Files:**
- Modify: `src/app/(app)/caja/ventas/page.tsx` (pasar estados fiscales) y `ventas-cliente.tsx`

- [ ] **Step 1: Cargar estados fiscales en la page**

En `src/app/(app)/caja/ventas/page.tsx`, después de obtener `ventasIniciales`, traer los estados fiscales y pasarlos como prop. Agregar:
```tsx
import { estadosFiscales } from "@/lib/actions/comprobantes";
// … después de tener las ventas:
const fiscales = await estadosFiscales(ventasIniciales.map((v) => v.id));
// pasar <VentasCliente ventasIniciales={ventasIniciales} fiscales={fiscales} />
```

- [ ] **Step 2: Columna + acción en `ventas-cliente.tsx`**

(a) Ampliar props:
```tsx
export function VentasCliente({
  ventasIniciales,
  fiscales,
}: {
  ventasIniciales: VentaListado[];
  fiscales: Record<string, { estado: string; tipo: string | null }>;
}) {
```

(b) Helper de etiqueta (dentro del componente):
```tsx
  function etiquetaFiscal(id: string): string {
    const f = fiscales[id];
    if (!f) return "Sin factura";
    if (f.estado === "emitido") return `Factura ${f.tipo}`;
    if (f.estado === "pendiente") return "Pendiente";
    return "Error";
  }
```

(c) En la fila de la tabla, agregar una celda de estado fiscal después de la de Total (antes de la columna Estado). Agregar el `<th>Fiscal</th>` en el `<thead>` y en el `<tbody>`:
```tsx
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                            {etiquetaFiscal(v.id)}
                          </span>
                        </td>
```

(d) Botón "Facturar" en la columna Acción cuando la venta está activa y no tiene factura emitida. Al lado del botón Anular:
```tsx
                          {v.estado === "activa" && etiquetaFiscal(v.id) !== `Factura B` && etiquetaFiscal(v.id) !== `Factura A` ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={pending}
                              onClick={(e) => {
                                e.stopPropagation();
                                facturar(v);
                              }}
                            >
                              Facturar
                            </Button>
                          ) : null}
```

(e) Handler `facturar` (emite B directo; para A, el flujo completo vive en el cobro — desde la lista se ofrece B, que es el caso de reconexión/olvido):
```tsx
  function facturar(v: VentaListado) {
    startTransition(async () => {
      const { emitirComprobante } = await import("@/lib/actions/comprobantes");
      const res = await emitirComprobante({ venta_id: v.id, tipo: "B" });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Factura B emitida para #${v.ticket_nro}`);
      router.refresh();
    });
  }
```

> Nota: desde la lista se factura **B** (consumidor final), que cubre el caso "no había internet / se olvidó". La Factura A (con cliente) se hace en el cobro. Si más adelante querés A desde la lista, se reusa `FacturaPaso` en un diálogo.

- [ ] **Step 3: Typecheck + build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/caja/ventas/page.tsx" "src/app/(app)/caja/ventas/ventas-cliente.tsx"
git commit -m "feat(fiscal): estado fiscal y facturar/reintentar en la lista de ventas"
```

---

## Task 13: Pantalla de clientes en el admin

**Files:**
- Create: `src/app/admin/clientes/page.tsx`, `src/app/admin/clientes/clientes-cliente.tsx`
- Modify: `src/app/admin/layout.tsx` (link en el sidebar)

- [ ] **Step 1: Page server**

Crear `src/app/admin/clientes/page.tsx`:
```tsx
import { listarClientes } from "@/lib/actions/clientes";
import { ClientesCliente } from "./clientes-cliente";

export default async function ClientesPage() {
  const clientes = await listarClientes();
  return (
    <div className="p-4">
      <h1 className="mb-4 text-xl font-bold">Clientes</h1>
      <ClientesCliente clientesIniciales={clientes} />
    </div>
  );
}
```

- [ ] **Step 2: Client component (lista + alta/edición)**

Crear `src/app/admin/clientes/clientes-cliente.tsx`:
```tsx
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
```

- [ ] **Step 3: Link en el sidebar**

En `src/app/admin/layout.tsx`, agregar un link "Clientes" → `/admin/clientes` junto al de "Empleados" (seguir el patrón exacto del link existente).

- [ ] **Step 4: Typecheck + build**

Run: `pnpm exec tsc --noEmit && pnpm build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add "src/app/admin/clientes" "src/app/admin/layout.tsx"
git commit -m "feat(fiscal): pantalla de clientes en el admin"
```

---

## Task 14: Verificación end-to-end (homologación)

**Files:** ninguno (verificación manual + suites).

- [ ] **Step 1: Configurar homologación**

En `.env.local`: `AFIP_ENV=homologacion`, `AFIP_CUIT=20409378472`, `AFIP_PTO_VTA=1`, `AFIP_ACCESS_TOKEN=<token de app.afipsdk.com>` (o vacío si el modo dev del SDK no lo exige).

- [ ] **Step 2: Unit en verde**

Run: `pnpm test`
Expected: PASS (calculo, cuit, qr).

- [ ] **Step 3: Prueba de emisión B**

Correr `pnpm dev`, hacer una venta, en el cobro elegir **Factura B**. Verificar:
- Toast "Factura B emitida".
- En Supabase, fila en `comprobantes` con `estado='emitido'`, `cae` y `numero` cargados.
- El ticket fiscal se imprime (o en preview) con encabezado, transparencia Ley 27742, CAE y **QR**.

- [ ] **Step 4: Prueba de emisión A**

Nueva venta → **Factura A** → alta rápida de un cliente con un CUIT de prueba válido → verificar CAE, y que el ticket muestra el cliente + IVA discriminado.

- [ ] **Step 5: Prueba de error/reintento**

Con `AFIP_ACCESS_TOKEN` inválido (o sin red), intentar facturar: debe quedar `estado='error'` y mostrar el mensaje; corregido el token, **Reintentar** desde la lista de ventas emite OK.

- [ ] **Step 6: Impresora real**

Imprimir un ticket fiscal en la OCOM POS-80 y confirmar que el **QR sale nítido** (SVG). Si no, ajustar tamaño (`w-[35mm]`) o `errorCorrectionLevel`.

- [ ] **Step 7: Build final + commit de cierre**

Run: `pnpm exec tsc --noEmit && pnpm build && pnpm lint`
Expected: todo verde.
```bash
git commit --allow-empty -m "chore(fiscal): verificacion e2e homologacion OK"
```

---

## Notas de handoff a producción (fuera de esta iteración)
1. Cuenta en app.afipsdk.com → `AFIP_ACCESS_TOKEN` real.
2. Certificado de AFIP autorizado para el WS de facturación (panel de AFIP SDK).
3. Confirmar que el PdV **0007** es tipo *Web Services* y que Easy POS dejó de facturar; setear `AFIP_PTO_VTA=7`, `AFIP_CUIT=27288869990`, `AFIP_ENV=produccion`.
4. Primera factura real de prueba por monto chico y verificar el CAE en el sitio de AFIP.

---

## Ajustes durante la implementación (verificados)

Correcciones aplicadas tras verificar la API real de AFIP SDK y dos rondas de revisión adversaria:
- **Cálculo fiscal:** `total` por construcción (cierra `ImpTotal = ImpNeto + ImpIVA + ImpOpEx` exacto) y **rechazo de alícuota desconocida** (no la trata como exenta en silencio).
- **Cliente AFIP:** `cert`+`key` en producción; `CbteFch` como entero (TZ Argentina); `CondicionIVAReceptorId` validado por clase (A: RI/Mono, B: CF/Exento); emisor de display separado del CUIT/PdV de env (client-safe).
- **QR:** omite `tipoDocRec`/`nroDocRec` para consumidor final (de corresponder).
- **Anti doble-facturación:** se reclama una fila `pendiente` (índice único) antes de llamar a AFIP; en reintento se **reconcilia con `getVoucherInfo`** (adopta el CAE si AFIP ya lo autorizó; bloquea si la consulta es inconcluso).
- **Anti doble-impresión:** se limpian las fuentes de impresión al iniciar cada cobro.
- **UI:** `key` en el form de clientes (evita corrupción al editar); fecha de emisión en el ticket fiscal; facturar desde la lista imprime el ticket fiscal y permite A/B; guards de auth en actions con admin client; prefill de CUIT.
- **Punto de venta 0007 reutilizado** (solo se factura con este sistema).

## Backlog (no bloquea el MVP)
- **Factura B identificada sobre umbral (~$10.000.000):** hoy la B va siempre a consumidor final (99/0); sobre el umbral de RG, AFIP exige identificar al comprador (DNI/CUIT) y hoy quedaría en `error`. Sумar captura de documento para B sobre monto.
- **Notas de crédito** para devoluciones de ventas facturadas.
- **PDF del comprobante** para enviar por WhatsApp/email.
- **Reconciliación completa** de la fila `error`/`pendiente` (ya se registra el `numero` intentado).

## Pendiente del dueño (para ir a producción)
- Task 14 (e2e en **homologación**): requiere `AFIP_ACCESS_TOKEN` de app.afipsdk.com.
- Aplicar la migración `0012_fiscal.sql` en Supabase.
- Para producción: certificado AFIP (cert/key), confirmar PdV 0007 como Web Services, `AFIP_ENV=produccion`.
