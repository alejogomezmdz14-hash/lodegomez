-- ============================================================================
-- El "quién fue" es SOLO para los gastos de empleados (hay que saber cuánto se
-- llevó cada uno porque lo pagan). Casa y local son una sola cuenta del negocio:
-- no se pide persona.
--   · gasto_empleado → persona OBLIGATORIA
--   · cuenta_corriente (casa) y gasto_local → sin persona
-- Idempotente.
-- ============================================================================

create or replace function public.registrar_venta(
  p_pagos      jsonb,
  p_items      jsonb,
  p_caja_id    text default 'principal',
  p_persona_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_empleado uuid := auth.uid();
  v_resueltos jsonb; v_total numeric(12,2); v_total_iva numeric(12,2);
  v_venta_id uuid; v_ticket_nro bigint; v_creada_en timestamptz;
  v_suma numeric(12,2); v_npagos integer; v_medio public.medio_pago; v_mixto boolean;
  v_caja text := coalesce(nullif(trim(p_caja_id), ''), 'principal');
  v_medio_txt text; v_al_costo boolean;
begin
  if v_empleado is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'La venta no tiene items'; end if;
  if p_pagos is null or jsonb_array_length(p_pagos) = 0 then raise exception 'Falta el medio de pago'; end if;

  if exists (select 1 from jsonb_to_recordset(p_items) as i(producto_id uuid, cantidad numeric)
             where i.producto_id is null or i.cantidad is null or i.cantidad <= 0)
    then raise exception 'Items inválidos (la cantidad debe ser mayor a 0)'; end if;

  if exists (select 1 from jsonb_array_elements(p_pagos) p
             where (p->>'monto') is null or (p->>'monto')::numeric <= 0
                or (p->>'medio') not in ('efectivo','qr','tarjeta','transferencia','cuenta_corriente','gasto_local','gasto_empleado'))
    then raise exception 'Pago inválido'; end if;

  v_medio_txt := p_pagos->0->>'medio';
  v_al_costo  := v_medio_txt in ('cuenta_corriente','gasto_local');

  if exists (select 1 from jsonb_array_elements(p_pagos) p
             where (p->>'medio') in ('cuenta_corriente','gasto_local','gasto_empleado'))
     and jsonb_array_length(p_pagos) > 1 then
    raise exception 'Los gastos no se pueden combinar con otro medio de pago';
  end if;
  -- Solo los gastos de empleados necesitan saber quién fue.
  if v_medio_txt = 'gasto_empleado' and p_persona_id is null then
    raise exception 'Falta indicar qué empleado fue';
  end if;

  select jsonb_agg(jsonb_build_object(
    'producto_id', p.id, 'codigo', p.codigo, 'descripcion', p.descripcion,
    'cantidad', round(i.cantidad::numeric, 3), 'es_pesable', p.es_pesable,
    'precio_unit', (
      case when v_al_costo
        then coalesce(nullif(p.precio_costo, 0),
                      case when p.es_pesable then coalesce(p.precio_por_kg,0) else coalesce(p.precio_venta,0) end)
        else case when p.es_pesable then coalesce(p.precio_por_kg,0) else coalesce(p.precio_venta,0) end
      end)::numeric(12,2),
    'costo_unit', p.precio_costo, 'iva_pct', p.iva_pct,
    'subtotal', round((
      case when v_al_costo
        then coalesce(nullif(p.precio_costo, 0),
                      case when p.es_pesable then coalesce(p.precio_por_kg,0) else coalesce(p.precio_venta,0) end)
        else case when p.es_pesable then coalesce(p.precio_por_kg,0) else coalesce(p.precio_venta,0) end
      end) * round(i.cantidad::numeric,3), 2)
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
  v_medio := v_medio_txt::public.medio_pago;

  insert into public.ventas (empleado_id, caja_id, medio_pago, es_mixto, total, total_iva, gasto_persona_id)
  values (v_empleado, v_caja, v_medio, v_mixto, v_total, v_total_iva,
          case when v_medio_txt = 'gasto_empleado' then p_persona_id else null end)
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
grant execute on function public.registrar_venta(jsonb, jsonb, text, uuid) to authenticated;

-- El desglose por persona es SOLO de los gastos de empleados.
create or replace function public.gastos_por_persona(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.total desc), '[]'::jsonb) into v from (
    select coalesce(u.nombre, 'Sin indicar') as persona,
           'gasto_empleado'::text as tipo,
           count(distinct ve.id) as tickets,
           coalesce(sum(vp.monto),0) as total
    from public.ventas ve
    join public.venta_pagos vp on vp.venta_id = ve.id
    left join public.usuarios u on u.id = ve.gasto_persona_id
    where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta
      and vp.medio_pago = 'gasto_empleado'
    group by u.nombre
  ) r;
  return v;
end $$;
grant execute on function public.gastos_por_persona(timestamptz, timestamptz) to authenticated;
