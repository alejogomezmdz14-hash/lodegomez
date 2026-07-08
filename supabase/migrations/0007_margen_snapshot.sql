-- ============================================================================
-- Fase 3 (fix) — Margen histórico correcto + ranking por producto.
-- Guarda el COSTO al momento de la venta (venta_items.costo_unit) para que el
-- margen no dependa del costo actual (clave con inflación). Reagrupa el ranking
-- por producto (no por texto snapshot). Idempotente.
-- ============================================================================

alter table public.venta_items add column if not exists costo_unit numeric(12,2);

-- registrar_venta: ahora snapshotea también el costo.
create or replace function public.registrar_venta(
  p_medio_pago public.medio_pago, p_items jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_empleado uuid := auth.uid();
  v_resueltos jsonb; v_total numeric(12,2); v_total_iva numeric(12,2);
  v_venta_id uuid; v_ticket_nro bigint; v_creada_en timestamptz;
begin
  if v_empleado is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene items'; end if;
  if exists (select 1 from jsonb_to_recordset(p_items) as i(producto_id uuid, cantidad numeric)
             where i.producto_id is null or i.cantidad is null or i.cantidad <= 0)
    then raise exception 'Items inválidos (la cantidad debe ser mayor a 0)'; end if;

  select jsonb_agg(jsonb_build_object(
    'producto_id', p.id, 'codigo', p.codigo, 'descripcion', p.descripcion,
    'cantidad', round(i.cantidad::numeric, 3), 'es_pesable', p.es_pesable,
    'precio_unit', (case when p.es_pesable then coalesce(p.precio_por_kg,0) else coalesce(p.precio_venta,0) end)::numeric(12,2),
    'costo_unit', p.precio_costo,
    'iva_pct', p.iva_pct,
    'subtotal', round((case when p.es_pesable then coalesce(p.precio_por_kg,0) else coalesce(p.precio_venta,0) end) * round(i.cantidad::numeric,3), 2)
  )) into v_resueltos
  from jsonb_to_recordset(p_items) as i(producto_id uuid, cantidad numeric)
  join public.productos p on p.id = i.producto_id and p.activo = true;

  if v_resueltos is null or jsonb_array_length(v_resueltos) <> jsonb_array_length(p_items)
    then raise exception 'Algún producto no existe o está inactivo'; end if;
  if exists (select 1 from jsonb_array_elements(v_resueltos) it where (it->>'precio_unit')::numeric <= 0)
    then raise exception 'Algún producto no tiene precio cargado'; end if;

  select sum((it->>'subtotal')::numeric),
         sum(round((it->>'subtotal')::numeric * (it->>'iva_pct')::numeric / (100 + (it->>'iva_pct')::numeric), 2))
  into v_total, v_total_iva from jsonb_array_elements(v_resueltos) it;

  insert into public.ventas (empleado_id, medio_pago, total, total_iva)
  values (v_empleado, p_medio_pago, v_total, v_total_iva)
  returning id, ticket_nro, creada_en into v_venta_id, v_ticket_nro, v_creada_en;

  insert into public.venta_items (venta_id, producto_id, codigo, descripcion, cantidad, es_pesable, precio_unit, costo_unit, iva_pct, subtotal)
  select v_venta_id, (it->>'producto_id')::uuid, it->>'codigo', it->>'descripcion',
    (it->>'cantidad')::numeric, (it->>'es_pesable')::boolean, (it->>'precio_unit')::numeric,
    (it->>'costo_unit')::numeric, (it->>'iva_pct')::numeric, (it->>'subtotal')::numeric
  from jsonb_array_elements(v_resueltos) it;

  perform set_config('app.en_venta','on',true);
  update public.productos p set stock = p.stock - agg.cant
  from (select (it->>'producto_id')::uuid as pid, sum((it->>'cantidad')::numeric) as cant
        from jsonb_array_elements(v_resueltos) it group by 1) agg
  where p.id = agg.pid;

  return jsonb_build_object('id', v_venta_id, 'ticket_nro', v_ticket_nro, 'creada_en', v_creada_en,
    'medio_pago', p_medio_pago, 'total', v_total, 'total_iva', v_total_iva, 'items', v_resueltos);
end $$;

-- metricas_periodo: margen desde el costo snapshoteado (vi.costo_unit).
create or replace function public.metricas_periodo(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_margen numeric(16,2);
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select jsonb_build_object(
    'total', coalesce(sum(total),0), 'cant_tickets', count(*),
    'efectivo', coalesce(sum(total) filter (where medio_pago='efectivo'),0),
    'qr', coalesce(sum(total) filter (where medio_pago='qr'),0),
    'tarjeta', coalesce(sum(total) filter (where medio_pago='tarjeta'),0),
    'transferencia', coalesce(sum(total) filter (where medio_pago='transferencia'),0)
  ) into v from public.ventas
  where estado='activa' and creada_en >= p_desde and creada_en < p_hasta;

  select coalesce(sum((vi.precio_unit - vi.costo_unit) * vi.cantidad), 0) into v_margen
  from public.venta_items vi
  join public.ventas ve on ve.id = vi.venta_id
  where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta
    and vi.costo_unit is not null;

  return v || jsonb_build_object('margen', v_margen,
    'anulaciones', (select count(*) from public.ventas where estado='anulada' and anulada_en >= p_desde and anulada_en < p_hasta));
end $$;
grant execute on function public.metricas_periodo(timestamptz, timestamptz) to authenticated;

-- ranking_productos: agrupa por PRODUCTO (no por texto snapshot); margen snapshot.
create or replace function public.ranking_productos(p_desde timestamptz, p_hasta timestamptz, p_limite integer default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.facturado desc), '[]'::jsonb) into v from (
    select
      max(coalesce(p.codigo, vi.codigo))           as codigo,
      max(coalesce(p.descripcion, vi.descripcion)) as descripcion,
      sum(vi.cantidad)                              as unidades,
      sum(vi.subtotal)                              as facturado,
      sum(case when vi.costo_unit is not null then (vi.precio_unit - vi.costo_unit) * vi.cantidad else 0 end) as margen
    from public.venta_items vi
    join public.ventas ve on ve.id = vi.venta_id
    left join public.productos p on p.id = vi.producto_id
    where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta
    group by coalesce(vi.producto_id::text, 'cod:' || coalesce(vi.codigo, ''))
    order by facturado desc
    limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.ranking_productos(timestamptz, timestamptz, integer) to authenticated;
