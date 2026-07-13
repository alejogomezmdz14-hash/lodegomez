-- ============================================================================
-- Filtro por día en Ventas y Cierres: listar_ventas y listar_cierres aceptan
-- rango de fechas opcional (p_desde/p_hasta). Sin fechas = comportamiento actual
-- (los más recientes por límite). Mantiene el filtro por empleado (0014) y los
-- egresos en el cierre (0015). Idempotente.
-- ============================================================================

-- listar_ventas: agrega p_desde/p_hasta. Se dropea la versión de 1 arg para
-- que no queden overloads ambiguos.
drop function if exists public.listar_ventas(integer);
create or replace function public.listar_ventas(
  p_limite integer default 50,
  p_desde  timestamptz default null,
  p_hasta  timestamptz default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.creada_en desc), '[]'::jsonb) into v from (
    select ve.id, ve.ticket_nro, ve.creada_en, ve.medio_pago, ve.es_mixto, ve.total, ve.estado, ve.cierre_id, u.nombre as empleado_nombre
    from public.ventas ve
    left join public.usuarios u on u.id = ve.empleado_id
    where (public.es_admin() or ve.empleado_id = auth.uid())
      and (p_desde is null or ve.creada_en >= p_desde)
      and (p_hasta is null or ve.creada_en < p_hasta)
    order by ve.creada_en desc limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.listar_ventas(integer, timestamptz, timestamptz) to authenticated;

-- listar_cierres: agrega p_desde/p_hasta (sobre `hasta`, la fecha del cierre) y
-- mantiene egresos_efectivo.
drop function if exists public.listar_cierres(integer);
create or replace function public.listar_cierres(
  p_limite integer default 30,
  p_desde  timestamptz default null,
  p_hasta  timestamptz default null
)
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
    where (p_desde is null or c.hasta >= p_desde)
      and (p_hasta is null or c.hasta < p_hasta)
    order by c.creado_en desc
    limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.listar_cierres(integer, timestamptz, timestamptz) to authenticated;
