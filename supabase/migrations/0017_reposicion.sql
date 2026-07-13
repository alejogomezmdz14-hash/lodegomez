-- ============================================================================
-- Reposición: (a) excluir productos de la reposición sin sacarlos de la venta
-- (temporada), (b) configurar el punto de reposición (stock mínimo) por rubro.
-- El reset de los números viejos (mínimos a null + borrar faltantes) va aparte
-- (script/SQL de datos). Idempotente.
-- ============================================================================

-- (a) Columna para excluir de la reposición (sigue vendible en el POS).
alter table public.productos add column if not exists excluir_reposicion boolean not null default false;

-- productos_a_reponer: excluye los marcados y devuelve el id (para poder excluir
-- desde la UI).
create or replace function public.productos_a_reponer()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.rubro nulls last, r.descripcion), '[]'::jsonb)
  into v
  from (
    select id, codigo, descripcion, rubro, stock, stock_minimo
    from public.productos
    where activo and not excluir_reposicion
      and stock_minimo is not null and stock <= stock_minimo
  ) r;
  return v;
end $$;
grant execute on function public.productos_a_reponer() to authenticated;

-- (b) Rubros con su cantidad y el mínimo representativo actual (para la config).
create or replace function public.rubros_reposicion()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.rubro), '[]'::jsonb)
  into v
  from (
    select coalesce(nullif(trim(rubro), ''), 'SIN RUBRO') as rubro,
           count(*) as cant,
           max(stock_minimo) as minimo_actual
    from public.productos
    where activo and not es_pesable
    group by coalesce(nullif(trim(rubro), ''), 'SIN RUBRO')
  ) r;
  return v;
end $$;
grant execute on function public.rubros_reposicion() to authenticated;

-- Setear el mínimo de todos los productos (no pesables) de un rubro.
-- minimo <= 0 o null => sin mínimo (se saca de la reposición).
create or replace function public.set_minimo_rubro(p_rubro text, p_minimo integer)
returns integer language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  perform set_config('app.en_venta', 'on', true); -- no auditar ni tocar "modificado por"
  with upd as (
    update public.productos
    set stock_minimo = case when p_minimo is null or p_minimo <= 0 then null else p_minimo end
    where not es_pesable
      and coalesce(nullif(trim(rubro), ''), 'SIN RUBRO') = p_rubro
    returning 1
  )
  select count(*) into v_count from upd;
  return v_count;
end $$;
grant execute on function public.set_minimo_rubro(text, integer) to authenticated;

-- Excluir / incluir un producto puntual de la reposición.
create or replace function public.set_excluir_reposicion(p_id uuid, p_excluir boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  perform set_config('app.en_venta', 'on', true);
  update public.productos set excluir_reposicion = p_excluir where id = p_id;
end $$;
grant execute on function public.set_excluir_reposicion(uuid, boolean) to authenticated;

-- Productos excluidos de la reposición (para poder re-incluirlos).
create or replace function public.productos_excluidos()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.descripcion), '[]'::jsonb)
  into v
  from (
    select id, codigo, descripcion, rubro, stock, stock_minimo
    from public.productos
    where activo and excluir_reposicion
    order by descripcion
    limit 500
  ) r;
  return v;
end $$;
grant execute on function public.productos_excluidos() to authenticated;
