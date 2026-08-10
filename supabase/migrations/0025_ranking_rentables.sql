-- ============================================================================
-- Ranking por RENTABILIDAD: de lo que más se vende, a qué le sacás más.
--   · nuevo orden 'rentable': ordena por margen % (no por plata), quedándose
--     solo con productos que tienen movimiento real (unidades >= p_min_unid) y
--     costo cargado. Si no, un producto vendido una vez ensucia el podio.
--   · el margen ahora exige costo_unit > 0 (un costo en 0 es "sin cargar", no
--     un producto con 100% de margen).
-- Idempotente.
-- ============================================================================

drop function if exists public.ranking_productos(timestamptz, timestamptz, integer, text);

create or replace function public.ranking_productos(
  p_desde     timestamptz default null,
  p_hasta     timestamptz default null,
  p_limite    integer default 10,
  p_orden     text default 'facturado',  -- facturado | unidades | ganancia | rentable
  p_min_unid  numeric default 5           -- piso de movimiento para 'rentable'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.orden desc), '[]'::jsonb) into v from (
    select codigo, descripcion, unidades, facturado, margen, margen_pct, orden
    from (
      select
        max(coalesce(p.codigo, vi.codigo))           as codigo,
        max(coalesce(p.descripcion, vi.descripcion)) as descripcion,
        sum(vi.cantidad)                              as unidades,
        sum(vi.subtotal)                              as facturado,
        sum(case when vi.costo_unit > 0 then (vi.precio_unit - vi.costo_unit) * vi.cantidad else 0 end) as margen,
        case when sum(case when vi.costo_unit > 0 then vi.subtotal else 0 end) > 0
          then round(
            100 * sum(case when vi.costo_unit > 0 then (vi.precio_unit - vi.costo_unit) * vi.cantidad else 0 end)
                / sum(case when vi.costo_unit > 0 then vi.subtotal else 0 end), 1)
          else null end as margen_pct,
        case p_orden
          when 'unidades' then sum(vi.cantidad)
          when 'ganancia' then sum(case when vi.costo_unit > 0 then (vi.precio_unit - vi.costo_unit) * vi.cantidad else 0 end)
          when 'rentable' then
            case when sum(case when vi.costo_unit > 0 then vi.subtotal else 0 end) > 0
              then round(100 * sum(case when vi.costo_unit > 0 then (vi.precio_unit - vi.costo_unit) * vi.cantidad else 0 end)
                       / sum(case when vi.costo_unit > 0 then vi.subtotal else 0 end), 1)
              else null end
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
    ) g
    -- Para 'rentable': solo productos con costo cargado y movimiento real.
    where p_orden <> 'rentable' or (g.margen_pct is not null and g.unidades >= p_min_unid)
    order by orden desc
    limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.ranking_productos(timestamptz, timestamptz, integer, text, numeric) to authenticated;
