-- ============================================================================
-- Ranking de productos: histórico + ganancia por producto.
--  · p_desde / p_hasta ahora son OPCIONALES: null = TODO el histórico.
--  · Se agrega margen_pct (qué % le saca a ese producto) y costo total.
--  · Se EXCLUYEN los gastos (casa / local / empleados): no son ventas, y los
--    de casa/local están valuados al costo, así que ensuciaban el ranking con
--    "ventas" de margen cero.
--  · Se puede ordenar por facturado (default), unidades o ganancia.
-- Idempotente.
-- ============================================================================

drop function if exists public.ranking_productos(timestamptz, timestamptz, integer);

create or replace function public.ranking_productos(
  p_desde  timestamptz default null,
  p_hasta  timestamptz default null,
  p_limite integer default 10,
  p_orden  text default 'facturado'   -- 'facturado' | 'unidades' | 'ganancia'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.orden desc), '[]'::jsonb) into v from (
    select
      max(coalesce(p.codigo, vi.codigo))           as codigo,
      max(coalesce(p.descripcion, vi.descripcion)) as descripcion,
      sum(vi.cantidad)                              as unidades,
      sum(vi.subtotal)                              as facturado,
      sum(case when vi.costo_unit is not null then (vi.precio_unit - vi.costo_unit) * vi.cantidad else 0 end) as margen,
      -- % sobre lo facturado, contando solo los renglones que tienen costo
      case when sum(case when vi.costo_unit is not null then vi.subtotal else 0 end) > 0
        then round(
          100 * sum(case when vi.costo_unit is not null then (vi.precio_unit - vi.costo_unit) * vi.cantidad else 0 end)
              / sum(case when vi.costo_unit is not null then vi.subtotal else 0 end), 1)
        else null end as margen_pct,
      case p_orden
        when 'unidades' then sum(vi.cantidad)
        when 'ganancia' then sum(case when vi.costo_unit is not null then (vi.precio_unit - vi.costo_unit) * vi.cantidad else 0 end)
        else sum(vi.subtotal)
      end as orden
    from public.venta_items vi
    join public.ventas ve on ve.id = vi.venta_id
    left join public.productos p on p.id = vi.producto_id
    where ve.estado='activa'
      and (p_desde is null or ve.creada_en >= p_desde)
      and (p_hasta is null or ve.creada_en <  p_hasta)
      and not exists (select 1 from public.venta_pagos vp
                      where vp.venta_id = ve.id
                        and vp.medio_pago in ('cuenta_corriente','gasto_local','gasto_empleado'))
    group by coalesce(vi.producto_id::text, 'cod:' || coalesce(vi.codigo, ''))
    order by orden desc
    limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.ranking_productos(timestamptz, timestamptz, integer, text) to authenticated;
