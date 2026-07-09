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
