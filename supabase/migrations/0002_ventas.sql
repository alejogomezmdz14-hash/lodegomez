-- ============================================================================
-- Fase 2 (MVP POS) — Ventas: ventas, venta_items y el RPC registrar_venta.
-- Idempotente (estilo del 0001). Correr en el SQL Editor de Supabase.
--
-- Modelo: las ventas NO se insertan desde el cliente. La única vía de escritura
-- es el RPC public.registrar_venta (SECURITY DEFINER), que calcula precios desde
-- el catálogo (autoritativo), inserta venta + items y descuenta stock en UNA
-- transacción. Stock puede quedar negativo (consistencia eventual, a propósito).
-- ============================================================================

-- === Enums ===
do $$ begin
  create type public.medio_pago as enum ('efectivo', 'qr', 'tarjeta', 'transferencia');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.estado_venta as enum ('activa', 'anulada', 'devuelta');
exception when duplicate_object then null; end $$;

-- === Helper: usuario provisionado (tiene fila en usuarios) ===
-- Se define acá también para que esta migración sea auto-suficiente aunque no
-- se haya corrido el patch de endurecimiento. Idempotente (create or replace).
create or replace function public.es_usuario()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid());
$$;

-- ============================================================================
-- ventas
-- ============================================================================
create table if not exists public.ventas (
  id                uuid primary key default gen_random_uuid(),
  ticket_nro        bigint generated always as identity,  -- número humano de ticket
  empleado_id       uuid references public.usuarios (id) on delete set null,
  caja_id           text not null default 'principal',    -- forward-compat multi-caja
  medio_pago        public.medio_pago not null,
  total             numeric(12,2) not null,
  total_iva         numeric(12,2),                          -- informativo (precio ya incluye IVA)
  estado            public.estado_venta not null default 'activa',
  anulada_por       uuid references public.usuarios (id) on delete set null,
  anulada_en        timestamptz,
  motivo_anulacion  text,
  creada_en         timestamptz not null default now()
);
create unique index if not exists ventas_ticket_nro_idx on public.ventas (ticket_nro);
create index if not exists ventas_creada_en_idx  on public.ventas (creada_en);
create index if not exists ventas_empleado_idx   on public.ventas (empleado_id);
create index if not exists ventas_medio_idx      on public.ventas (medio_pago);
create index if not exists ventas_estado_idx     on public.ventas (estado);
alter table public.ventas enable row level security;

-- ============================================================================
-- venta_items (con snapshots: el catálogo puede cambiar después de la venta)
-- ============================================================================
create table if not exists public.venta_items (
  id            uuid primary key default gen_random_uuid(),
  venta_id      uuid not null references public.ventas (id) on delete cascade,
  producto_id   uuid references public.productos (id) on delete set null,
  codigo        text,                                   -- snapshot
  descripcion   text,                                   -- snapshot
  cantidad      numeric(12,3) not null default 1,       -- unidades o kg (pesables)
  es_pesable    boolean not null default false,
  precio_unit   numeric(12,2) not null,                 -- precio_venta o precio_por_kg
  iva_pct       numeric(4,1) not null,
  subtotal      numeric(12,2) not null
);
create index if not exists venta_items_venta_idx    on public.venta_items (venta_id);
create index if not exists venta_items_producto_idx on public.venta_items (producto_id);
alter table public.venta_items enable row level security;

-- Defensa en profundidad: cantidades y montos válidos (idempotente).
alter table public.venta_items drop constraint if exists venta_items_cantidad_pos;
alter table public.venta_items add  constraint venta_items_cantidad_pos check (cantidad > 0);
alter table public.venta_items drop constraint if exists venta_items_subtotal_nonneg;
alter table public.venta_items add  constraint venta_items_subtotal_nonneg check (subtotal >= 0);
alter table public.ventas drop constraint if exists ventas_total_nonneg;
alter table public.ventas add  constraint ventas_total_nonneg check (total >= 0);

-- ============================================================================
-- RLS: lectura para usuarios provisionados; SIN escritura desde clientes.
-- Toda escritura pasa por los RPC SECURITY DEFINER (corren como owner).
-- ============================================================================
drop policy if exists ventas_select on public.ventas;
create policy ventas_select on public.ventas
  for select to authenticated using (public.es_usuario());

drop policy if exists venta_items_select on public.venta_items;
create policy venta_items_select on public.venta_items
  for select to authenticated using (public.es_usuario());

-- ============================================================================
-- Los triggers de productos NO deben auditar ni marcar "modificado por" cuando
-- el stock baja por una venta (no es una edición manual). registrar_venta setea
-- app.en_venta='on' (local a la transacción) y estos triggers lo respetan.
-- Se redefinen (create or replace) las funciones del 0001 agregando ese guard.
-- ============================================================================
create or replace function public.productos_guard_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Congelar columnas admin-only para no-admins (auth.uid() nulo = servicio/SQL).
  if auth.uid() is not null and not public.es_admin() then
    new.codigo         := old.codigo;
    new.descripcion    := old.descripcion;
    new.rubro          := old.rubro;
    new.rubro_original := old.rubro_original;
    new.precio_costo   := old.precio_costo;
    new.margen_pct     := old.margen_pct;
    new.iva_pct        := old.iva_pct;
    new.stock_minimo   := old.stock_minimo;
    new.es_pesable     := old.es_pesable;
    new.precio_por_kg  := old.precio_por_kg;
    new.activo         := old.activo;
  end if;

  if current_setting('app.en_venta', true) = 'on' then
    -- Venta: solo timestamp técnico; no ensuciar "modificado por/en".
    new.modificado_por := old.modificado_por;
    new.modificado_en  := old.modificado_en;
    new.actualizado_en := now();
  else
    new.modificado_por := coalesce(auth.uid(), old.modificado_por);
    new.modificado_en  := now();
    new.actualizado_en := now();
  end if;
  return new;
end $$;

create or replace function public.productos_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No auditar el descuento de stock por venta.
  if current_setting('app.en_venta', true) = 'on' then
    return null;
  end if;

  if new.precio_venta is distinct from old.precio_venta then
    insert into public.auditoria (entidad, entidad_id, campo, valor_ant, valor_nuevo, usuario_id)
    values ('productos', new.id, 'precio_venta', old.precio_venta::text, new.precio_venta::text, auth.uid());
  end if;
  if new.precio_costo is distinct from old.precio_costo then
    insert into public.auditoria (entidad, entidad_id, campo, valor_ant, valor_nuevo, usuario_id)
    values ('productos', new.id, 'precio_costo', old.precio_costo::text, new.precio_costo::text, auth.uid());
  end if;
  if new.stock is distinct from old.stock then
    insert into public.auditoria (entidad, entidad_id, campo, valor_ant, valor_nuevo, usuario_id)
    values ('productos', new.id, 'stock', old.stock::text, new.stock::text, auth.uid());
  end if;
  return null;
end $$;

-- ============================================================================
-- RPC registrar_venta: única vía de alta de ventas. Atómico.
--   p_items: jsonb  [{ "producto_id": <uuid>, "cantidad": <numeric> }, ...]
--   returns: jsonb  { id, ticket_nro, creada_en, medio_pago, total, total_iva, items[] }
-- ============================================================================
create or replace function public.registrar_venta(
  p_medio_pago public.medio_pago,
  p_items      jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empleado   uuid := auth.uid();
  v_resueltos  jsonb;
  v_total      numeric(12,2);
  v_total_iva  numeric(12,2);
  v_venta_id   uuid;
  v_ticket_nro bigint;
  v_creada_en  timestamptz;
begin
  if v_empleado is null or not public.es_usuario() then
    raise exception 'No autorizado';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'La venta no tiene items';
  end if;

  -- Validar cada renglón: producto_id presente y cantidad > 0.
  if exists (
    select 1
    from jsonb_to_recordset(p_items) as i(producto_id uuid, cantidad numeric)
    where i.producto_id is null or i.cantidad is null or i.cantidad <= 0
  ) then
    raise exception 'Items inválidos (la cantidad debe ser mayor a 0)';
  end if;

  -- Resolver items contra el catálogo (precio/iva/desc autoritativos; cantidad redondeada una sola vez).
  select jsonb_agg(jsonb_build_object(
    'producto_id', p.id,
    'codigo',      p.codigo,
    'descripcion', p.descripcion,
    'cantidad',    round(i.cantidad::numeric, 3),
    'es_pesable',  p.es_pesable,
    'precio_unit', (case when p.es_pesable then coalesce(p.precio_por_kg, 0)
                        else coalesce(p.precio_venta, 0) end)::numeric(12,2),
    'iva_pct',     p.iva_pct,
    'subtotal',    round((case when p.es_pesable then coalesce(p.precio_por_kg, 0)
                              else coalesce(p.precio_venta, 0) end)
                         * round(i.cantidad::numeric, 3), 2)
  ))
  into v_resueltos
  from jsonb_to_recordset(p_items) as i(producto_id uuid, cantidad numeric)
  join public.productos p on p.id = i.producto_id and p.activo = true;

  -- Todos los renglones deben resolver (producto existe y está activo): si
  -- alguno se cayó, abortar en vez de cobrar de menos en silencio.
  if v_resueltos is null
     or jsonb_array_length(v_resueltos) <> jsonb_array_length(p_items) then
    raise exception 'Algún producto no existe o está inactivo';
  end if;

  -- Ningún renglón puede salir gratis (precio no cargado).
  if exists (
    select 1 from jsonb_array_elements(v_resueltos) it
    where (it->>'precio_unit')::numeric <= 0
  ) then
    raise exception 'Algún producto no tiene precio cargado';
  end if;

  select
    sum((it->>'subtotal')::numeric),
    sum(round((it->>'subtotal')::numeric * (it->>'iva_pct')::numeric
              / (100 + (it->>'iva_pct')::numeric), 2))
  into v_total, v_total_iva
  from jsonb_array_elements(v_resueltos) it;

  insert into public.ventas (empleado_id, medio_pago, total, total_iva)
  values (v_empleado, p_medio_pago, v_total, v_total_iva)
  returning id, ticket_nro, creada_en into v_venta_id, v_ticket_nro, v_creada_en;

  insert into public.venta_items
    (venta_id, producto_id, codigo, descripcion, cantidad, es_pesable, precio_unit, iva_pct, subtotal)
  select
    v_venta_id,
    (it->>'producto_id')::uuid,
    it->>'codigo',
    it->>'descripcion',
    (it->>'cantidad')::numeric,
    (it->>'es_pesable')::boolean,
    (it->>'precio_unit')::numeric,
    (it->>'iva_pct')::numeric,
    (it->>'subtotal')::numeric
  from jsonb_array_elements(v_resueltos) it;

  -- Descontar stock (agrupado por producto; tolera negativo). El flag evita
  -- auditar/ensuciar "modificado por" en los triggers de productos.
  perform set_config('app.en_venta', 'on', true);
  update public.productos p
  set stock = p.stock - agg.cant
  from (
    select (it->>'producto_id')::uuid as pid, sum((it->>'cantidad')::numeric) as cant
    from jsonb_array_elements(v_resueltos) it
    group by 1
  ) agg
  where p.id = agg.pid;

  return jsonb_build_object(
    'id',         v_venta_id,
    'ticket_nro', v_ticket_nro,
    'creada_en',  v_creada_en,
    'medio_pago', p_medio_pago,
    'total',      v_total,
    'total_iva',  v_total_iva,
    'items',      v_resueltos
  );
end $$;

grant execute on function public.registrar_venta(public.medio_pago, jsonb) to authenticated;
