-- ============================================================================
-- Cuenta corriente (gastos de la casa).
-- Se agrega 'cuenta_corriente' como medio de pago: lo que la familia se lleva
-- se cobra normal pero NO entra plata. Entonces:
--   · no suma al efectivo esperado del cierre (ya se filtra por medio),
--   · aparece como línea propia en el cierre,
--   · en el panel NO cuenta como "Vendido" ni "Ganancia" (no entró plata) y
--     se muestra aparte como gasto de la casa.
-- Idempotente.
--
-- NOTA: si el editor de SQL se queja al agregar el valor al enum, corré SOLO la
-- primera línea (alter type ...), y después el resto.
-- ============================================================================

alter type public.medio_pago add value if not exists 'cuenta_corriente';

-- Columna del cierre para guardar lo que se fue a cuenta corriente en ese turno.
alter table public.cierres_caja add column if not exists total_cuenta numeric(12,2) not null default 0;

-- ============================================================================
-- registrar_venta: aceptar el nuevo medio. (Base: versión vigente de 0018.)
-- ============================================================================
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
                or (p->>'medio') not in ('efectivo','qr','tarjeta','transferencia','cuenta_corriente'))
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

-- ============================================================================
-- Cierre: mostrar la cuenta corriente del turno. (Base: 0019, por empleado.)
-- ============================================================================
create or replace function public.resumen_caja_actual(p_empleado_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_total numeric(12,2); v_cant integer;
  v_efec numeric(12,2); v_qr numeric(12,2); v_tar numeric(12,2); v_transf numeric(12,2); v_cta numeric(12,2);
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
    coalesce(sum(vp.monto) filter (where vp.medio_pago='transferencia'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='cuenta_corriente'),0)
  into v_efec, v_qr, v_tar, v_transf, v_cta
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
    'total_cuenta',v_cta,
    'egresos_efectivo',v_egr_efec,'egresos_transferencia',v_egr_transf,
    'efectivo_esperado', round(v_efec - v_egr_efec, 2));
end $$;
grant execute on function public.resumen_caja_actual(uuid) to authenticated;

create or replace function public.cerrar_caja(p_empleado_id uuid default null, p_efectivo_contado numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid; v_hasta timestamptz := now(); v_total numeric(12,2); v_cant integer;
  v_efec numeric(12,2); v_qr numeric(12,2); v_tar numeric(12,2); v_transf numeric(12,2); v_cta numeric(12,2);
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
    coalesce(sum(vp.monto) filter (where vp.medio_pago='transferencia'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='cuenta_corriente'),0)
  into v_efec, v_qr, v_tar, v_transf, v_cta
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
    total_tarjeta=v_tar, total_transferencia=v_transf, total_cuenta=v_cta, egresos_efectivo=v_egr_efec,
    efectivo_contado=p_efectivo_contado, diferencia=v_dif where id=v_id;
  return jsonb_build_object('id',v_id,'desde',null,'hasta',v_hasta,'cant_ventas',v_cant,'total',v_total,
    'total_efectivo',v_efec,'total_qr',v_qr,'total_tarjeta',v_tar,'total_transferencia',v_transf,
    'total_cuenta',v_cta,
    'egresos_efectivo',v_egr_efec,'efectivo_esperado',v_esperado,
    'efectivo_contado',p_efectivo_contado,'diferencia',v_dif);
end $$;
grant execute on function public.cerrar_caja(uuid, numeric) to authenticated;

-- listar_cierres: sumar total_cuenta al historial.
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
           c.total_cuenta, c.egresos_efectivo, c.efectivo_contado, c.diferencia,
           u.nombre as empleado_nombre
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

-- ============================================================================
-- metricas_periodo: "Vendido" y "Ganancia" SIN la cuenta corriente (no entró
-- plata), y la cuenta corriente aparte como gasto de la casa.
-- ============================================================================
create or replace function public.metricas_periodo(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total numeric(16,2); v_cant integer; v_margen numeric(16,2); v_cta numeric(16,2);
  v_efec numeric(16,2); v_qr numeric(16,2); v_tar numeric(16,2); v_transf numeric(16,2);
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;

  -- Vendido = lo cobrado por medios reales (excluye cuenta corriente, y en una
  -- venta mixta toma solo la parte que sí se cobró).
  select
    coalesce(sum(vp.monto) filter (where vp.medio_pago <> 'cuenta_corriente'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='efectivo'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='qr'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='tarjeta'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='transferencia'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='cuenta_corriente'),0)
  into v_total, v_efec, v_qr, v_tar, v_transf, v_cta
  from public.venta_pagos vp join public.ventas ve on ve.id = vp.venta_id
  where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta;

  -- Tickets: los que cobraron algo de verdad.
  select count(distinct ve.id) into v_cant
  from public.ventas ve join public.venta_pagos vp on vp.venta_id = ve.id
  where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta
    and vp.medio_pago <> 'cuenta_corriente';

  -- Ganancia: solo de ventas sin nada a cuenta corriente (lo de la casa no es ganancia).
  select coalesce(sum((vi.precio_unit - vi.costo_unit) * vi.cantidad), 0) into v_margen
  from public.venta_items vi join public.ventas ve on ve.id = vi.venta_id
  where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta
    and vi.costo_unit is not null
    and not exists (select 1 from public.venta_pagos vp
                    where vp.venta_id = ve.id and vp.medio_pago='cuenta_corriente');

  return jsonb_build_object('total',v_total,'cant_tickets',v_cant,'efectivo',v_efec,'qr',v_qr,
    'tarjeta',v_tar,'transferencia',v_transf,'cuenta_corriente',v_cta,'margen',v_margen,
    'anulaciones',(select count(*) from public.ventas where estado='anulada' and anulada_en >= p_desde and anulada_en < p_hasta));
end $$;
grant execute on function public.metricas_periodo(timestamptz, timestamptz) to authenticated;
