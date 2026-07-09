-- ============================================================================
-- Conexión directa a AFIP — cache del Ticket de Acceso (TA) de WSAA.
-- El TA dura 12h y se comparte entre las 2 cajas. token/sign son credenciales
-- fiscales: solo el server (service_role, que saltea RLS) lo lee/escribe.
-- ============================================================================
create table if not exists public.afip_ta (
  id              uuid primary key default gen_random_uuid(),
  cuit            bigint not null,
  service         text not null default 'wsfe',
  entorno         text not null,              -- 'homologacion' | 'produccion'
  token           text not null,
  sign            text not null,
  generation_time timestamptz not null,
  expiration_time timestamptz not null,
  creado_en       timestamptz not null default now(),
  unique (cuit, service, entorno)
);
alter table public.afip_ta enable row level security;
-- Sin policy de SELECT para authenticated: token/sign son credenciales. Solo service_role.
