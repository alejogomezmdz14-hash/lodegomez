-- ============================================================================
-- Fase 3 — Dashboard (admin). RPCs de solo lectura gateadas por es_admin().
-- Idempotente. Correr DESPUÉS de 0004_cierre_tagging.sql.
-- El margen es ESTIMADO: usa el precio_costo ACTUAL del catálogo (no un
-- snapshot al momento de la venta) y solo cuenta ítems con costo cargado.
-- ============================================================================

create or replace function public.metricas_periodo(
  p_desde timestamptz, p_hasta timestamptz
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_margen numeric(16,2);
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;

  select jsonb_build_object(
    'total', coalesce(sum(total),0),
    'cant_tickets', count(*),
    'efectivo', coalesce(sum(total) filter (where medio_pago='efectivo'),0),
    'qr', coalesce(sum(total) filter (where medio_pago='qr'),0),
    'tarjeta', coalesce(sum(total) filter (where medio_pago='tarjeta'),0),
    'transferencia', coalesce(sum(total) filter (where medio_pago='transferencia'),0)
  ) into v
  from public.ventas
  where estado='activa' and creada_en >= p_desde and creada_en < p_hasta;

  select coalesce(sum((vi.precio_unit - p.precio_costo) * vi.cantidad), 0)
  into v_margen
  from public.venta_items vi
  join public.ventas ve on ve.id = vi.venta_id
  join public.productos p on p.id = vi.producto_id
  where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta
    and p.precio_costo is not null;

  return v || jsonb_build_object(
    'margen', v_margen,
    'anulaciones', (
      select count(*) from public.ventas
      where estado='anulada' and anulada_en >= p_desde and anulada_en < p_hasta
    )
  );
end $$;
grant execute on function public.metricas_periodo(timestamptz, timestamptz) to authenticated;

-- Ranking de productos por facturación (ganadores) en el período.
create or replace function public.ranking_productos(
  p_desde timestamptz, p_hasta timestamptz, p_limite integer default 10
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.facturado desc), '[]'::jsonb)
  into v
  from (
    select
      coalesce(vi.codigo, p.codigo)           as codigo,
      coalesce(vi.descripcion, p.descripcion)  as descripcion,
      sum(vi.cantidad)                          as unidades,
      sum(vi.subtotal)                          as facturado,
      sum(case when p.precio_costo is not null
               then (vi.precio_unit - p.precio_costo) * vi.cantidad
               else 0 end)                      as margen
    from public.venta_items vi
    join public.ventas ve on ve.id = vi.venta_id
    left join public.productos p on p.id = vi.producto_id
    where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta
    group by 1, 2
    order by facturado desc
    limit greatest(p_limite, 1)
  ) r;

  return v;
end $$;
grant execute on function public.ranking_productos(timestamptz, timestamptz, integer) to authenticated;
