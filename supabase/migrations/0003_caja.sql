-- ============================================================================
-- Fase 2 (Etapa 2) — Cierre de caja + eventos a dueños + anulación de ventas.
-- Idempotente. Correr en el SQL Editor de Supabase DESPUÉS de 0002_ventas.sql.
-- ============================================================================

-- === Enums ===
do $$ begin
  create type public.tipo_evento as enum ('anulacion', 'devolucion', 'alerta_precio');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- cierres_caja: cierre del turno por medio de pago (ventana temporal).
-- ============================================================================
create table if not exists public.cierres_caja (
  id                   uuid primary key default gen_random_uuid(),
  empleado_id          uuid references public.usuarios (id) on delete set null,
  caja_id              text not null default 'principal',
  desde                timestamptz,                 -- null = desde el inicio (primer cierre)
  hasta                timestamptz not null default now(),
  cant_ventas          integer not null default 0,
  total                numeric(12,2) not null default 0,
  total_efectivo       numeric(12,2) not null default 0,
  total_qr             numeric(12,2) not null default 0,
  total_tarjeta        numeric(12,2) not null default 0,
  total_transferencia  numeric(12,2) not null default 0,
  efectivo_contado     numeric(12,2),
  diferencia           numeric(12,2),
  creado_en            timestamptz not null default now()
);
create index if not exists cierres_caja_caja_idx on public.cierres_caja (caja_id, hasta);
alter table public.cierres_caja enable row level security;

drop policy if exists cierres_select on public.cierres_caja;
create policy cierres_select on public.cierres_caja
  for select to authenticated using (public.es_usuario());

-- ============================================================================
-- eventos_duenos: avisos a los dueños (anulaciones, devoluciones, suba de costo).
-- ============================================================================
create table if not exists public.eventos_duenos (
  id           uuid primary key default gen_random_uuid(),
  tipo         public.tipo_evento not null,
  venta_id     uuid references public.ventas (id) on delete set null,
  ticket_nro   bigint,
  empleado_id  uuid references public.usuarios (id) on delete set null,
  detalle      text,
  leido        boolean not null default false,
  creado_en    timestamptz not null default now()
);
create index if not exists eventos_duenos_leido_idx on public.eventos_duenos (leido, creado_en);
alter table public.eventos_duenos enable row level security;

-- La ven solo los dueños (admin). Se escribe por RPC (security definer).
drop policy if exists eventos_select_admin on public.eventos_duenos;
create policy eventos_select_admin on public.eventos_duenos
  for select to authenticated using (public.es_admin());
drop policy if exists eventos_update_admin on public.eventos_duenos;
create policy eventos_update_admin on public.eventos_duenos
  for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- ============================================================================
-- RPC resumen_caja_actual: totales del turno abierto (solo lectura).
-- ============================================================================
create or replace function public.resumen_caja_actual(p_caja_id text default 'principal')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_desde timestamptz;
  v_hasta timestamptz := now();
  v_total numeric(12,2); v_efec numeric(12,2); v_qr numeric(12,2);
  v_tar numeric(12,2); v_transf numeric(12,2); v_cant integer;
begin
  if auth.uid() is null or not public.es_usuario() then
    raise exception 'No autorizado';
  end if;

  v_desde := (select max(hasta) from public.cierres_caja where caja_id = p_caja_id);

  select
    coalesce(sum(total), 0),
    coalesce(sum(total) filter (where medio_pago = 'efectivo'), 0),
    coalesce(sum(total) filter (where medio_pago = 'qr'), 0),
    coalesce(sum(total) filter (where medio_pago = 'tarjeta'), 0),
    coalesce(sum(total) filter (where medio_pago = 'transferencia'), 0),
    count(*)
  into v_total, v_efec, v_qr, v_tar, v_transf, v_cant
  from public.ventas
  where caja_id = p_caja_id
    and estado = 'activa'
    and (v_desde is null or creada_en > v_desde)
    and creada_en <= v_hasta;

  return jsonb_build_object(
    'caja_id', p_caja_id, 'desde', v_desde, 'hasta', v_hasta,
    'cant_ventas', v_cant, 'total', v_total,
    'total_efectivo', v_efec, 'total_qr', v_qr,
    'total_tarjeta', v_tar, 'total_transferencia', v_transf
  );
end $$;
grant execute on function public.resumen_caja_actual(text) to authenticated;

-- ============================================================================
-- RPC cerrar_caja: registra el cierre del turno y devuelve el resumen.
-- ============================================================================
create or replace function public.cerrar_caja(
  p_caja_id          text default 'principal',
  p_efectivo_contado numeric default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_desde timestamptz;
  v_hasta timestamptz := now();
  v_total numeric(12,2); v_efec numeric(12,2); v_qr numeric(12,2);
  v_tar numeric(12,2); v_transf numeric(12,2); v_cant integer;
  v_dif numeric(12,2); v_id uuid;
begin
  if auth.uid() is null or not public.es_usuario() then
    raise exception 'No autorizado';
  end if;
  if p_efectivo_contado is not null and p_efectivo_contado < 0 then
    raise exception 'El efectivo contado no puede ser negativo';
  end if;

  v_desde := (select max(hasta) from public.cierres_caja where caja_id = p_caja_id);

  select
    coalesce(sum(total), 0),
    coalesce(sum(total) filter (where medio_pago = 'efectivo'), 0),
    coalesce(sum(total) filter (where medio_pago = 'qr'), 0),
    coalesce(sum(total) filter (where medio_pago = 'tarjeta'), 0),
    coalesce(sum(total) filter (where medio_pago = 'transferencia'), 0),
    count(*)
  into v_total, v_efec, v_qr, v_tar, v_transf, v_cant
  from public.ventas
  where caja_id = p_caja_id
    and estado = 'activa'
    and (v_desde is null or creada_en > v_desde)
    and creada_en <= v_hasta;

  v_dif := case when p_efectivo_contado is null then null
                else round(p_efectivo_contado - v_efec, 2) end;

  insert into public.cierres_caja
    (empleado_id, caja_id, desde, hasta, cant_ventas, total,
     total_efectivo, total_qr, total_tarjeta, total_transferencia,
     efectivo_contado, diferencia)
  values
    (auth.uid(), p_caja_id, v_desde, v_hasta, v_cant, v_total,
     v_efec, v_qr, v_tar, v_transf, p_efectivo_contado, v_dif)
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id, 'caja_id', p_caja_id, 'desde', v_desde, 'hasta', v_hasta,
    'cant_ventas', v_cant, 'total', v_total,
    'total_efectivo', v_efec, 'total_qr', v_qr,
    'total_tarjeta', v_tar, 'total_transferencia', v_transf,
    'efectivo_contado', p_efectivo_contado, 'diferencia', v_dif
  );
end $$;
grant execute on function public.cerrar_caja(text, numeric) to authenticated;

-- ============================================================================
-- RPC anular_venta: anula una venta activa, reintegra stock y avisa a dueños.
-- ============================================================================
create or replace function public.anular_venta(
  p_venta_id uuid,
  p_motivo   text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ticket bigint;
  v_estado public.estado_venta;
  v_total  numeric(12,2);
begin
  if auth.uid() is null or not public.es_usuario() then
    raise exception 'No autorizado';
  end if;

  select ticket_nro, estado, total
  into v_ticket, v_estado, v_total
  from public.ventas where id = p_venta_id for update;
  if not found then
    raise exception 'Venta no encontrada';
  end if;
  if v_estado <> 'activa' then
    raise exception 'La venta ya no está activa';
  end if;

  update public.ventas
  set estado = 'anulada', anulada_por = auth.uid(), anulada_en = now(),
      motivo_anulacion = p_motivo
  where id = p_venta_id;

  -- Reintegrar stock (sin auditar ni ensuciar "modificado por").
  perform set_config('app.en_venta', 'on', true);
  update public.productos p set stock = p.stock + agg.cant
  from (
    select producto_id, sum(cantidad) as cant
    from public.venta_items
    where venta_id = p_venta_id and producto_id is not null
    group by producto_id
  ) agg
  where p.id = agg.producto_id;

  -- Aviso a los dueños (aparece en el dashboard con ticket + hora).
  insert into public.eventos_duenos (tipo, venta_id, ticket_nro, empleado_id, detalle)
  values ('anulacion', p_venta_id, v_ticket, auth.uid(), coalesce(p_motivo, ''));

  return jsonb_build_object(
    'id', p_venta_id, 'ticket_nro', v_ticket, 'estado', 'anulada', 'total', v_total
  );
end $$;
grant execute on function public.anular_venta(uuid, text) to authenticated;
