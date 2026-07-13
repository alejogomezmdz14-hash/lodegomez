-- ============================================================================
-- Turnos (mañana / tarde) como "caja". Cada venta y cada egreso se marca con el
-- turno elegido (caja_id = 'manana' | 'tarde'), así el cierre corta solo lo del
-- turno y arranca uno nuevo. registrar_venta ahora acepta p_caja_id.
-- (resumen_caja_actual, cerrar_caja y movimientos_caja ya trabajan por caja_id.)
-- Idempotente.
-- ============================================================================

-- registrar_venta con p_caja_id (turno). Se dropea la versión de 2 args.
drop function if exists public.registrar_venta(jsonb, jsonb);
create or replace function public.registrar_venta(
  p_pagos   jsonb,
  p_items   jsonb,
  p_caja_id text default 'principal'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_empleado uuid := auth.uid();
  v_resueltos jsonb; v_total numeric(12,2); v_total_iva numeric(12,2);
  v_venta_id uuid; v_ticket_nro bigint; v_creada_en timestamptz;
  v_suma numeric(12,2); v_npagos integer; v_medio public.medio_pago; v_mixto boolean;
  v_caja text := coalesce(nullif(trim(p_caja_id), ''), 'principal');
begin
  if v_empleado is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene items'; end if;
  if p_pagos is null or jsonb_array_length(p_pagos) = 0 then raise exception 'Falta el medio de pago'; end if;

  if exists (select 1 from jsonb_to_recordset(p_items) as i(producto_id uuid, cantidad numeric)
             where i.producto_id is null or i.cantidad is null or i.cantidad <= 0)
    then raise exception 'Items inválidos (la cantidad debe ser mayor a 0)'; end if;

  if exists (select 1 from jsonb_array_elements(p_pagos) p
             where (p->>'monto') is null or (p->>'monto')::numeric <= 0
                or (p->>'medio') not in ('efectivo','qr','tarjeta','transferencia'))
    then raise exception 'Pago inválido'; end if;

  select jsonb_agg(jsonb_build_object(
    'producto_id', p.id, 'codigo', p.codigo, 'descripcion', p.descripcion,
    'cantidad', round(i.cantidad::numeric, 3), 'es_pesable', p.es_pesable,
    'precio_unit', (case when p.es_pesable then coalesce(p.precio_por_kg,0) else coalesce(p.precio_venta,0) end)::numeric(12,2),
    'costo_unit', p.precio_costo, 'iva_pct', p.iva_pct,
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

  select coalesce(sum((p->>'monto')::numeric), 0), count(*)
  into v_suma, v_npagos from jsonb_array_elements(p_pagos) p;
  if abs(v_suma - v_total) > 0.01 then
    raise exception 'El pago no coincide con el total';
  end if;

  v_mixto := v_npagos > 1;
  v_medio := (p_pagos->0->>'medio')::public.medio_pago;

  insert into public.ventas (empleado_id, caja_id, medio_pago, es_mixto, total, total_iva)
  values (v_empleado, v_caja, v_medio, v_mixto, v_total, v_total_iva)
  returning id, ticket_nro, creada_en into v_venta_id, v_ticket_nro, v_creada_en;

  insert into public.venta_items (venta_id, producto_id, codigo, descripcion, cantidad, es_pesable, precio_unit, costo_unit, iva_pct, subtotal)
  select v_venta_id, (it->>'producto_id')::uuid, it->>'codigo', it->>'descripcion',
    (it->>'cantidad')::numeric, (it->>'es_pesable')::boolean, (it->>'precio_unit')::numeric,
    (it->>'costo_unit')::numeric, (it->>'iva_pct')::numeric, (it->>'subtotal')::numeric
  from jsonb_array_elements(v_resueltos) it;

  insert into public.venta_pagos (venta_id, medio_pago, monto)
  select v_venta_id, (p->>'medio')::public.medio_pago, round((p->>'monto')::numeric, 2)
  from jsonb_array_elements(p_pagos) p;

  perform set_config('app.en_venta','on',true);
  update public.productos p set stock = p.stock - agg.cant
  from (select (it->>'producto_id')::uuid as pid, sum((it->>'cantidad')::numeric) as cant
        from jsonb_array_elements(v_resueltos) it group by 1) agg where p.id = agg.pid;

  return jsonb_build_object('id', v_venta_id, 'ticket_nro', v_ticket_nro, 'creada_en', v_creada_en,
    'medio_pago', v_medio, 'es_mixto', v_mixto, 'total', v_total, 'total_iva', v_total_iva,
    'items', v_resueltos, 'pagos', p_pagos);
end $$;
grant execute on function public.registrar_venta(jsonb, jsonb, text) to authenticated;

-- listar_cierres: incluir caja_id (turno) en el historial.
drop function if exists public.listar_cierres(integer);
drop function if exists public.listar_cierres(integer, timestamptz, timestamptz);
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
    select c.id, c.creado_en, c.hasta, c.caja_id, c.cant_ventas, c.total,
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
