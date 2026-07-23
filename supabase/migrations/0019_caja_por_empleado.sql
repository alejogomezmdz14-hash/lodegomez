-- ============================================================================
-- Caja POR EMPLEADO (se elimina el concepto de turno mañana/tarde).
-- Cada empleado tiene su caja = sus ventas + egresos con cierre_id null. La
-- cierra él (o el admin). El scope pasa de caja_id (turno) a empleado_id.
--  - resumen_caja_actual(p_empleado_id): default = uno mismo; el admin puede ver
--    la de cualquiera.
--  - cerrar_caja(p_empleado_id): cierra la caja de ese empleado.
--  - cajas_abiertas(): lista (admin) de empleados con caja abierta.
-- registrar_venta y movimientos_caja no cambian: ya guardan empleado_id.
-- Idempotente.
-- ============================================================================

drop function if exists public.resumen_caja_actual(text);
create or replace function public.resumen_caja_actual(p_empleado_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_total numeric(12,2); v_cant integer;
  v_efec numeric(12,2); v_qr numeric(12,2); v_tar numeric(12,2); v_transf numeric(12,2);
  v_egr_efec numeric(12,2); v_egr_transf numeric(12,2);
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  v_emp := coalesce(p_empleado_id, auth.uid());
  if v_emp <> auth.uid() and not public.es_admin() then raise exception 'No autorizado'; end if;
  select coalesce(sum(total),0), count(*) into v_total, v_cant
  from public.ventas where empleado_id = v_emp and estado='activa' and cierre_id is null;
  select
    coalesce(sum(vp.monto) filter (where vp.medio_pago='efectivo'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='qr'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='tarjeta'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='transferencia'),0)
  into v_efec, v_qr, v_tar, v_transf
  from public.venta_pagos vp join public.ventas ve on ve.id = vp.venta_id
  where ve.empleado_id = v_emp and ve.estado='activa' and ve.cierre_id is null;
  select
    coalesce(sum(monto) filter (where medio_pago='efectivo'),0),
    coalesce(sum(monto) filter (where medio_pago='transferencia'),0)
  into v_egr_efec, v_egr_transf
  from public.movimientos_caja
  where empleado_id = v_emp and cierre_id is null;
  return jsonb_build_object('caja_id',null,'desde',null,'hasta',now(),'cant_ventas',v_cant,'total',v_total,
    'total_efectivo',v_efec,'total_qr',v_qr,'total_tarjeta',v_tar,'total_transferencia',v_transf,
    'egresos_efectivo',v_egr_efec,'egresos_transferencia',v_egr_transf,
    'efectivo_esperado', round(v_efec - v_egr_efec, 2));
end $$;
grant execute on function public.resumen_caja_actual(uuid) to authenticated;

drop function if exists public.cerrar_caja(text, numeric);
create or replace function public.cerrar_caja(p_empleado_id uuid default null, p_efectivo_contado numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid; v_hasta timestamptz := now(); v_total numeric(12,2); v_cant integer;
  v_efec numeric(12,2); v_qr numeric(12,2); v_tar numeric(12,2); v_transf numeric(12,2);
  v_egr_efec numeric(12,2); v_esperado numeric(12,2); v_dif numeric(12,2);
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  v_emp := coalesce(p_empleado_id, auth.uid());
  if v_emp <> auth.uid() and not public.es_admin() then raise exception 'No autorizado'; end if;
  if p_efectivo_contado is not null and p_efectivo_contado < 0 then raise exception 'El efectivo contado no puede ser negativo'; end if;
  perform pg_advisory_xact_lock(hashtext('cerrar_caja:'||v_emp::text)::bigint);
  insert into public.cierres_caja (empleado_id, caja_id, hasta) values (v_emp, 'principal', v_hasta) returning id into v_id;
  with reclamadas as (
    update public.ventas set cierre_id = v_id
    where empleado_id = v_emp and estado='activa' and cierre_id is null
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
  with reg as (
    update public.movimientos_caja set cierre_id = v_id
    where empleado_id = v_emp and cierre_id is null
    returning medio_pago, monto
  )
  select coalesce(sum(monto) filter (where medio_pago='efectivo'),0) into v_egr_efec from reg;
  v_esperado := round(v_efec - v_egr_efec, 2);
  v_dif := case when p_efectivo_contado is null then null else round(p_efectivo_contado - v_esperado, 2) end;
  update public.cierres_caja set cant_ventas=v_cant, total=v_total, total_efectivo=v_efec, total_qr=v_qr,
    total_tarjeta=v_tar, total_transferencia=v_transf, egresos_efectivo=v_egr_efec,
    efectivo_contado=p_efectivo_contado, diferencia=v_dif where id=v_id;
  return jsonb_build_object('id',v_id,'desde',null,'hasta',v_hasta,'cant_ventas',v_cant,'total',v_total,
    'total_efectivo',v_efec,'total_qr',v_qr,'total_tarjeta',v_tar,'total_transferencia',v_transf,
    'egresos_efectivo',v_egr_efec,'efectivo_esperado',v_esperado,
    'efectivo_contado',p_efectivo_contado,'diferencia',v_dif);
end $$;
grant execute on function public.cerrar_caja(uuid, numeric) to authenticated;

-- Lista de cajas abiertas por empleado (para el admin).
create or replace function public.cajas_abiertas()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.nombre), '[]'::jsonb) into v from (
    select ve.empleado_id, coalesce(u.nombre, 'Sin nombre') as nombre,
           count(*) as cant, coalesce(sum(ve.total),0) as total
    from public.ventas ve
    left join public.usuarios u on u.id = ve.empleado_id
    where ve.estado='activa' and ve.cierre_id is null and ve.empleado_id is not null
    group by ve.empleado_id, u.nombre
  ) r;
  return v;
end $$;
grant execute on function public.cajas_abiertas() to authenticated;
