-- ============================================================================
-- Egresos de caja: retiros de efectivo (el dueño saca plata) y pagos a
-- proveedores (efectivo o transferencia). El EFECTIVO resta del efectivo
-- esperado en el cierre; la transferencia se registra pero no toca el cajón.
-- Los egresos se "taggean" con cierre_id al cerrar, igual que las ventas.
-- Cualquier usuario provisionado puede registrar y ver (queda auditado por
-- empleado_id + fecha). Idempotente.
-- ============================================================================

create table if not exists public.movimientos_caja (
  id           uuid primary key default gen_random_uuid(),
  tipo         text not null check (tipo in ('retiro','pago_proveedor')),
  medio_pago   public.medio_pago not null,          -- efectivo | transferencia | qr | tarjeta
  monto        numeric(12,2) not null check (monto > 0),
  detalle      text,                                 -- proveedor o motivo del retiro
  caja_id      text not null default 'principal',
  empleado_id  uuid default auth.uid() references public.usuarios (id) on delete set null,
  cierre_id    uuid references public.cierres_caja (id) on delete set null,
  creada_en    timestamptz not null default now()
);
create index if not exists movimientos_caja_cierre_idx on public.movimientos_caja (cierre_id);
create index if not exists movimientos_caja_fecha_idx on public.movimientos_caja (creada_en);
alter table public.movimientos_caja enable row level security;

-- Ver: todos los usuarios provisionados (registro compartido de caja).
drop policy if exists movimientos_select on public.movimientos_caja;
create policy movimientos_select on public.movimientos_caja
  for select to authenticated using (public.es_usuario());
-- Registrar: cualquier usuario, siempre como uno mismo.
drop policy if exists movimientos_insert on public.movimientos_caja;
create policy movimientos_insert on public.movimientos_caja
  for insert to authenticated with check (public.es_usuario() and empleado_id = auth.uid());
-- Borrar: el admin cualquiera; el empleado solo lo suyo y solo si el turno no cerró.
drop policy if exists movimientos_delete on public.movimientos_caja;
create policy movimientos_delete on public.movimientos_caja
  for delete to authenticated
  using (public.es_admin() or (empleado_id = auth.uid() and cierre_id is null));

-- Guardar el efectivo egresado en el cierre.
alter table public.cierres_caja add column if not exists egresos_efectivo numeric(12,2) not null default 0;

-- ============================================================================
-- resumen_caja_actual: suma egresos del turno abierto y expone el efectivo esperado.
-- (Base: versión vigente de 0011 con venta_pagos + cierre_id.)
-- ============================================================================
create or replace function public.resumen_caja_actual(p_caja_id text default 'principal')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total numeric(12,2); v_cant integer;
  v_efec numeric(12,2); v_qr numeric(12,2); v_tar numeric(12,2); v_transf numeric(12,2);
  v_egr_efec numeric(12,2); v_egr_transf numeric(12,2);
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(sum(total),0), count(*) into v_total, v_cant
  from public.ventas where caja_id = p_caja_id and estado='activa' and cierre_id is null;
  select
    coalesce(sum(vp.monto) filter (where vp.medio_pago='efectivo'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='qr'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='tarjeta'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='transferencia'),0)
  into v_efec, v_qr, v_tar, v_transf
  from public.venta_pagos vp join public.ventas ve on ve.id = vp.venta_id
  where ve.caja_id = p_caja_id and ve.estado='activa' and ve.cierre_id is null;
  select
    coalesce(sum(monto) filter (where medio_pago='efectivo'),0),
    coalesce(sum(monto) filter (where medio_pago='transferencia'),0)
  into v_egr_efec, v_egr_transf
  from public.movimientos_caja
  where caja_id = p_caja_id and cierre_id is null;
  return jsonb_build_object('caja_id',p_caja_id,'desde',null,'hasta',now(),'cant_ventas',v_cant,'total',v_total,
    'total_efectivo',v_efec,'total_qr',v_qr,'total_tarjeta',v_tar,'total_transferencia',v_transf,
    'egresos_efectivo',v_egr_efec,'egresos_transferencia',v_egr_transf,
    'efectivo_esperado', round(v_efec - v_egr_efec, 2));
end $$;
grant execute on function public.resumen_caja_actual(text) to authenticated;

-- ============================================================================
-- cerrar_caja: taggea egresos + resta el efectivo egresado del esperado.
-- diferencia = contado − (efectivo de ventas − efectivo egresado).
-- ============================================================================
create or replace function public.cerrar_caja(p_caja_id text default 'principal', p_efectivo_contado numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_hasta timestamptz := now(); v_total numeric(12,2); v_cant integer;
  v_efec numeric(12,2); v_qr numeric(12,2); v_tar numeric(12,2); v_transf numeric(12,2);
  v_egr_efec numeric(12,2); v_esperado numeric(12,2); v_dif numeric(12,2);
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  if p_efectivo_contado is not null and p_efectivo_contado < 0 then raise exception 'El efectivo contado no puede ser negativo'; end if;
  perform pg_advisory_xact_lock(hashtext('cerrar_caja:'||p_caja_id)::bigint);
  insert into public.cierres_caja (empleado_id, caja_id, hasta) values (auth.uid(), p_caja_id, v_hasta) returning id into v_id;
  with reclamadas as (
    update public.ventas set cierre_id = v_id
    where caja_id = p_caja_id and estado='activa' and cierre_id is null
    returning id, total
  )
  select coalesce(sum(total),0), count(*) into v_total, v_cant from reclamadas;
  select
    coalesce(sum(vp.monto) filter (where vp.medio_pago='efectivo'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='qr'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='tarjeta'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='transferencia'),0)
  into v_efec, v_qr, v_tar, v_transf
  from public.venta_pagos vp join public.ventas ve on ve.id = vp.venta_id
  where ve.cierre_id = v_id;
  -- reclamar (tag) los egresos del turno abierto y sumar el efectivo egresado
  with reg as (
    update public.movimientos_caja set cierre_id = v_id
    where caja_id = p_caja_id and cierre_id is null
    returning medio_pago, monto
  )
  select coalesce(sum(monto) filter (where medio_pago='efectivo'),0) into v_egr_efec from reg;
  v_esperado := round(v_efec - v_egr_efec, 2);
  v_dif := case when p_efectivo_contado is null then null else round(p_efectivo_contado - v_esperado, 2) end;
  update public.cierres_caja set cant_ventas=v_cant, total=v_total, total_efectivo=v_efec, total_qr=v_qr,
    total_tarjeta=v_tar, total_transferencia=v_transf, egresos_efectivo=v_egr_efec,
    efectivo_contado=p_efectivo_contado, diferencia=v_dif where id=v_id;
  return jsonb_build_object('id',v_id,'caja_id',p_caja_id,'desde',null,'hasta',v_hasta,'cant_ventas',v_cant,'total',v_total,
    'total_efectivo',v_efec,'total_qr',v_qr,'total_tarjeta',v_tar,'total_transferencia',v_transf,
    'egresos_efectivo',v_egr_efec,'efectivo_esperado',v_esperado,
    'efectivo_contado',p_efectivo_contado,'diferencia',v_dif);
end $$;
grant execute on function public.cerrar_caja(text, numeric) to authenticated;

-- ============================================================================
-- listar_cierres: incluir egresos_efectivo en el historial.
-- ============================================================================
create or replace function public.listar_cierres(p_limite integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.creado_en desc), '[]'::jsonb)
  into v
  from (
    select c.id, c.creado_en, c.hasta, c.cant_ventas, c.total,
           c.total_efectivo, c.total_qr, c.total_tarjeta, c.total_transferencia,
           c.egresos_efectivo, c.efectivo_contado, c.diferencia, u.nombre as empleado_nombre
    from public.cierres_caja c
    left join public.usuarios u on u.id = c.empleado_id
    order by c.creado_en desc
    limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.listar_cierres(integer) to authenticated;

-- Listado de egresos con el nombre de quién lo registró (para la pantalla Egresos).
create or replace function public.listar_egresos(p_limite integer default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.creada_en desc), '[]'::jsonb)
  into v
  from (
    select m.id, m.tipo, m.medio_pago, m.monto, m.detalle, m.cierre_id, m.creada_en,
           u.nombre as empleado_nombre
    from public.movimientos_caja m
    left join public.usuarios u on u.id = m.empleado_id
    order by m.creada_en desc
    limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.listar_egresos(integer) to authenticated;

-- Egresos de un período (para el panel admin).
create or replace function public.egresos_periodo(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_retiros numeric(12,2); v_prov_efec numeric(12,2); v_prov_transf numeric(12,2); v_cant integer;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select
    coalesce(sum(monto) filter (where tipo='retiro'),0),
    coalesce(sum(monto) filter (where tipo='pago_proveedor' and medio_pago='efectivo'),0),
    coalesce(sum(monto) filter (where tipo='pago_proveedor' and medio_pago='transferencia'),0),
    count(*)
  into v_retiros, v_prov_efec, v_prov_transf, v_cant
  from public.movimientos_caja
  where creada_en >= p_desde and creada_en < p_hasta;
  return jsonb_build_object('retiros',v_retiros,'prov_efectivo',v_prov_efec,'prov_transferencia',v_prov_transf,'cantidad',v_cant);
end $$;
grant execute on function public.egresos_periodo(timestamptz, timestamptz) to authenticated;
