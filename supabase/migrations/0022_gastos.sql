-- ============================================================================
-- Gastos: tres destinos de mercadería que sale SIN que entre plata al cajón.
--   · cuenta_corriente  → casa      · valuado AL COSTO   · persona opcional
--   · gasto_local       → el local  · valuado AL COSTO   · persona OBLIGATORIA
--   · gasto_empleado    → empleados · AL PRECIO DE VENTA · persona OBLIGATORIA
--     (los empleados sí pagan: queda anotado cuánto se llevó cada uno)
-- Ninguno suma al efectivo del cierre ni a "Vendido"/"Ganancia" del panel.
-- Idempotente.
--
-- NOTA: si el editor se queja con los `alter type`, corré SOLO esas dos líneas
-- primero y después el resto.
-- ============================================================================

alter type public.medio_pago add value if not exists 'gasto_local';
alter type public.medio_pago add value if not exists 'gasto_empleado';

-- A nombre de quién se anota el gasto.
alter table public.ventas
  add column if not exists gasto_persona_id uuid references public.usuarios (id) on delete set null;
create index if not exists ventas_gasto_persona_idx on public.ventas (gasto_persona_id);

-- Totales por tipo en el cierre.
alter table public.cierres_caja add column if not exists total_gasto_local numeric(12,2) not null default 0;
alter table public.cierres_caja add column if not exists total_gasto_empleado numeric(12,2) not null default 0;

-- Lista de empleados para el selector "¿quién fue?" (solo nombres).
create or replace function public.listar_empleados()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', coalesce(nombre,'Sin nombre')) order by nombre), '[]'::jsonb)
  into v from public.usuarios;
  return v;
end $$;
grant execute on function public.listar_empleados() to authenticated;

-- ============================================================================
-- registrar_venta: precio al COSTO para casa/local, y "quién fue".
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
  v_medio_txt text; v_al_costo boolean; v_es_gasto boolean;
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
  v_es_gasto  := v_medio_txt in ('cuenta_corriente','gasto_local','gasto_empleado');
  v_al_costo  := v_medio_txt in ('cuenta_corriente','gasto_local');

  -- Un gasto no se mezcla con otro medio: los precios se calculan distinto.
  if exists (select 1 from jsonb_array_elements(p_pagos) p
             where (p->>'medio') in ('cuenta_corriente','gasto_local','gasto_empleado'))
     and jsonb_array_length(p_pagos) > 1 then
    raise exception 'Los gastos no se pueden combinar con otro medio de pago';
  end if;
  if v_medio_txt in ('gasto_local','gasto_empleado') and p_persona_id is null then
    raise exception 'Falta indicar quién fue';
  end if;

  -- precio_unit: al costo para casa/local (si el producto no tiene costo cargado
  -- se cae al precio de venta para no trabar la operación); de venta en el resto.
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
          case when v_es_gasto then p_persona_id else null end)
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

-- ============================================================================
-- Cierre: los tres gastos como líneas propias (no tocan el efectivo).
-- ============================================================================
create or replace function public.resumen_caja_actual(p_empleado_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_total numeric(12,2); v_cant integer;
  v_efec numeric(12,2); v_qr numeric(12,2); v_tar numeric(12,2); v_transf numeric(12,2);
  v_cta numeric(12,2); v_gl numeric(12,2); v_ge numeric(12,2);
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
    coalesce(sum(vp.monto) filter (where vp.medio_pago='cuenta_corriente'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='gasto_local'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='gasto_empleado'),0)
  into v_efec, v_qr, v_tar, v_transf, v_cta, v_gl, v_ge
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
    'total_cuenta',v_cta,'total_gasto_local',v_gl,'total_gasto_empleado',v_ge,
    'egresos_efectivo',v_egr_efec,'egresos_transferencia',v_egr_transf,
    'efectivo_esperado', round(v_efec - v_egr_efec, 2));
end $$;
grant execute on function public.resumen_caja_actual(uuid) to authenticated;

create or replace function public.cerrar_caja(p_empleado_id uuid default null, p_efectivo_contado numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid; v_hasta timestamptz := now(); v_total numeric(12,2); v_cant integer;
  v_efec numeric(12,2); v_qr numeric(12,2); v_tar numeric(12,2); v_transf numeric(12,2);
  v_cta numeric(12,2); v_gl numeric(12,2); v_ge numeric(12,2);
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
    coalesce(sum(vp.monto) filter (where vp.medio_pago='cuenta_corriente'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='gasto_local'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='gasto_empleado'),0)
  into v_efec, v_qr, v_tar, v_transf, v_cta, v_gl, v_ge
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
    total_tarjeta=v_tar, total_transferencia=v_transf, total_cuenta=v_cta,
    total_gasto_local=v_gl, total_gasto_empleado=v_ge, egresos_efectivo=v_egr_efec,
    efectivo_contado=p_efectivo_contado, diferencia=v_dif where id=v_id;
  return jsonb_build_object('id',v_id,'desde',null,'hasta',v_hasta,'cant_ventas',v_cant,'total',v_total,
    'total_efectivo',v_efec,'total_qr',v_qr,'total_tarjeta',v_tar,'total_transferencia',v_transf,
    'total_cuenta',v_cta,'total_gasto_local',v_gl,'total_gasto_empleado',v_ge,
    'egresos_efectivo',v_egr_efec,'efectivo_esperado',v_esperado,
    'efectivo_contado',p_efectivo_contado,'diferencia',v_dif);
end $$;
grant execute on function public.cerrar_caja(uuid, numeric) to authenticated;

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
           c.total_cuenta, c.total_gasto_local, c.total_gasto_empleado,
           c.egresos_efectivo, c.efectivo_contado, c.diferencia,
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
-- Panel: los tres gastos fuera de "Vendido"/"Ganancia", cada uno con su total.
-- ============================================================================
create or replace function public.metricas_periodo(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total numeric(16,2); v_cant integer; v_margen numeric(16,2);
  v_cta numeric(16,2); v_gl numeric(16,2); v_ge numeric(16,2);
  v_efec numeric(16,2); v_qr numeric(16,2); v_tar numeric(16,2); v_transf numeric(16,2);
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;

  select
    coalesce(sum(vp.monto) filter (where vp.medio_pago not in ('cuenta_corriente','gasto_local','gasto_empleado')),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='efectivo'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='qr'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='tarjeta'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='transferencia'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='cuenta_corriente'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='gasto_local'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='gasto_empleado'),0)
  into v_total, v_efec, v_qr, v_tar, v_transf, v_cta, v_gl, v_ge
  from public.venta_pagos vp join public.ventas ve on ve.id = vp.venta_id
  where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta;

  select count(distinct ve.id) into v_cant
  from public.ventas ve join public.venta_pagos vp on vp.venta_id = ve.id
  where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta
    and vp.medio_pago not in ('cuenta_corriente','gasto_local','gasto_empleado');

  select coalesce(sum((vi.precio_unit - vi.costo_unit) * vi.cantidad), 0) into v_margen
  from public.venta_items vi join public.ventas ve on ve.id = vi.venta_id
  where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta
    and vi.costo_unit is not null
    and not exists (select 1 from public.venta_pagos vp
                    where vp.venta_id = ve.id
                      and vp.medio_pago in ('cuenta_corriente','gasto_local','gasto_empleado'));

  return jsonb_build_object('total',v_total,'cant_tickets',v_cant,'efectivo',v_efec,'qr',v_qr,
    'tarjeta',v_tar,'transferencia',v_transf,
    'cuenta_corriente',v_cta,'gasto_local',v_gl,'gasto_empleado',v_ge,
    'margen',v_margen,
    'anulaciones',(select count(*) from public.ventas where estado='anulada' and anulada_en >= p_desde and anulada_en < p_hasta));
end $$;
grant execute on function public.metricas_periodo(timestamptz, timestamptz) to authenticated;

-- Desglose de gastos por persona y tipo (para el panel).
create or replace function public.gastos_por_persona(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.total desc), '[]'::jsonb) into v from (
    select coalesce(u.nombre, 'Sin indicar') as persona,
           vp.medio_pago::text as tipo,
           count(distinct ve.id) as tickets,
           coalesce(sum(vp.monto),0) as total
    from public.ventas ve
    join public.venta_pagos vp on vp.venta_id = ve.id
    left join public.usuarios u on u.id = ve.gasto_persona_id
    where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta
      and vp.medio_pago in ('cuenta_corriente','gasto_local','gasto_empleado')
    group by u.nombre, vp.medio_pago
  ) r;
  return v;
end $$;
grant execute on function public.gastos_por_persona(timestamptz, timestamptz) to authenticated;
drop function if exists public.registrar_venta(jsonb, jsonb, text); -- overload viejo: create-or-replace con firma nueva creaba una 2da funcion y la llamada quedaba ambigua
