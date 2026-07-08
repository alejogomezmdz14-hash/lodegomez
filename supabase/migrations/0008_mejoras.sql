-- ============================================================================
-- Mejoras: reposición (faltantes manuales + productos bajo mínimo),
-- historial de cierres y ventas por empleado. Idempotente.
-- ============================================================================

-- === Faltantes cargados a mano por el empleado (además del stock bajo auto) ===
create table if not exists public.faltantes_manuales (
  id           uuid primary key default gen_random_uuid(),
  texto        text not null,
  cargado_por  uuid default auth.uid() references public.usuarios (id) on delete set null,
  resuelto     boolean not null default false,
  creado_en    timestamptz not null default now()
);
alter table public.faltantes_manuales enable row level security;

drop policy if exists faltantes_select on public.faltantes_manuales;
create policy faltantes_select on public.faltantes_manuales
  for select to authenticated using (public.es_usuario());
drop policy if exists faltantes_insert on public.faltantes_manuales;
create policy faltantes_insert on public.faltantes_manuales
  for insert to authenticated with check (public.es_usuario());
drop policy if exists faltantes_update on public.faltantes_manuales;
create policy faltantes_update on public.faltantes_manuales
  for update to authenticated using (public.es_usuario()) with check (public.es_usuario());
drop policy if exists faltantes_delete on public.faltantes_manuales;
create policy faltantes_delete on public.faltantes_manuales
  for delete to authenticated using (public.es_usuario());

-- === Productos bajo el punto de reposición (comparación columna-a-columna) ===
create or replace function public.productos_a_reponer()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.rubro nulls last, r.descripcion), '[]'::jsonb)
  into v
  from (
    select codigo, descripcion, rubro, stock, stock_minimo
    from public.productos
    where activo and stock_minimo is not null and stock <= stock_minimo
  ) r;
  return v;
end $$;
grant execute on function public.productos_a_reponer() to authenticated;

-- === Historial de cierres (con el empleado que cerró) ===
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
           c.efectivo_contado, c.diferencia, u.nombre as empleado_nombre
    from public.cierres_caja c
    left join public.usuarios u on u.id = c.empleado_id
    order by c.creado_en desc
    limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.listar_cierres(integer) to authenticated;

-- === Ventas por empleado en un período (admin) ===
create or replace function public.ventas_por_empleado(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.total desc), '[]'::jsonb)
  into v
  from (
    select coalesce(u.nombre, 'Sin asignar') as empleado,
           count(*) as tickets,
           coalesce(sum(ve.total), 0) as total
    from public.ventas ve
    left join public.usuarios u on u.id = ve.empleado_id
    where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta
    group by ve.empleado_id, u.nombre
    order by total desc
  ) r;
  return v;
end $$;
grant execute on function public.ventas_por_empleado(timestamptz, timestamptz) to authenticated;
