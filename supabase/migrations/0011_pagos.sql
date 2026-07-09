-- ============================================================================
-- Pago dividido: una venta puede pagarse con varios medios (parte transferencia,
-- parte QR, parte efectivo). El desglose vive en venta_pagos; el cierre y el
-- panel calculan "por medio de pago" desde ahí (no desde ventas.medio_pago).
-- Idempotente.
-- ============================================================================

create table if not exists public.venta_pagos (
  id          uuid primary key default gen_random_uuid(),
  venta_id    uuid not null references public.ventas (id) on delete cascade,
  medio_pago  public.medio_pago not null,
  monto       numeric(12,2) not null check (monto > 0)
);
create index if not exists venta_pagos_venta_idx on public.venta_pagos (venta_id);
create index if not exists venta_pagos_medio_idx on public.venta_pagos (medio_pago);
alter table public.venta_pagos enable row level security;
drop policy if exists venta_pagos_select on public.venta_pagos;
create policy venta_pagos_select on public.venta_pagos
  for select to authenticated using (public.es_usuario());

-- Marca de venta con pago mixto (para mostrarla como "Mixto").
alter table public.ventas add column if not exists es_mixto boolean not null default false;

-- Backfill: las ventas viejas (sin desglose) obtienen un pago único = su total.
insert into public.venta_pagos (venta_id, medio_pago, monto)
select v.id, v.medio_pago, v.total
from public.ventas v
where v.total > 0
  and not exists (select 1 from public.venta_pagos vp where vp.venta_id = v.id);

-- ============================================================================
-- registrar_venta: ahora recibe p_pagos (array de {medio, monto}) + p_items.
-- Valida que la suma de pagos = total. Reemplaza la versión de un solo medio.
-- ============================================================================
drop function if exists public.registrar_venta(public.medio_pago, jsonb);

create or replace function public.registrar_venta(p_pagos jsonb, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_empleado uuid := auth.uid();
  v_resueltos jsonb; v_total numeric(12,2); v_total_iva numeric(12,2);
  v_venta_id uuid; v_ticket_nro bigint; v_creada_en timestamptz;
  v_suma numeric(12,2); v_npagos integer; v_medio public.medio_pago; v_mixto boolean;
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

  insert into public.ventas (empleado_id, medio_pago, es_mixto, total, total_iva)
  values (v_empleado, v_medio, v_mixto, v_total, v_total_iva)
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
grant execute on function public.registrar_venta(jsonb, jsonb) to authenticated;

-- ============================================================================
-- Cierre y panel: totales POR MEDIO desde venta_pagos (montos reales).
-- ============================================================================
create or replace function public.resumen_caja_actual(p_caja_id text default 'principal')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total numeric(12,2); v_cant integer;
  v_efec numeric(12,2); v_qr numeric(12,2); v_tar numeric(12,2); v_transf numeric(12,2);
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(sum(total),0), count(*) into v_total, v_cant
  from public.ventas where caja_id = p_caja_id and estado='activa' and cierre_id is null;
  select
    coalesce(sum(vp.monto) filter (where vp.medio_pago='efectivo'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='qr'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='tarjeta'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='transferencia'),0)
  into v_efec, v_qr, v_tar, v_transf
  from public.venta_pagos vp join public.ventas ve on ve.id = vp.venta_id
  where ve.caja_id = p_caja_id and ve.estado='activa' and ve.cierre_id is null;
  return jsonb_build_object('caja_id',p_caja_id,'desde',null,'hasta',now(),'cant_ventas',v_cant,'total',v_total,
    'total_efectivo',v_efec,'total_qr',v_qr,'total_tarjeta',v_tar,'total_transferencia',v_transf);
end $$;
grant execute on function public.resumen_caja_actual(text) to authenticated;

create or replace function public.cerrar_caja(p_caja_id text default 'principal', p_efectivo_contado numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_hasta timestamptz := now(); v_total numeric(12,2); v_cant integer;
  v_efec numeric(12,2); v_qr numeric(12,2); v_tar numeric(12,2); v_transf numeric(12,2); v_dif numeric(12,2);
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  if p_efectivo_contado is not null and p_efectivo_contado < 0 then raise exception 'El efectivo contado no puede ser negativo'; end if;
  perform pg_advisory_xact_lock(hashtext('cerrar_caja:'||p_caja_id)::bigint);
  insert into public.cierres_caja (empleado_id, caja_id, hasta) values (auth.uid(), p_caja_id, v_hasta) returning id into v_id;
  with reclamadas as (
    update public.ventas set cierre_id = v_id
    where caja_id = p_caja_id and estado='activa' and cierre_id is null
    returning id, total
  )
  select coalesce(sum(total),0), count(*) into v_total, v_cant from reclamadas;
  select
    coalesce(sum(vp.monto) filter (where vp.medio_pago='efectivo'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='qr'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='tarjeta'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='transferencia'),0)
  into v_efec, v_qr, v_tar, v_transf
  from public.venta_pagos vp join public.ventas ve on ve.id = vp.venta_id
  where ve.cierre_id = v_id;
  v_dif := case when p_efectivo_contado is null then null else round(p_efectivo_contado - v_efec, 2) end;
  update public.cierres_caja set cant_ventas=v_cant, total=v_total, total_efectivo=v_efec, total_qr=v_qr,
    total_tarjeta=v_tar, total_transferencia=v_transf, efectivo_contado=p_efectivo_contado, diferencia=v_dif where id=v_id;
  return jsonb_build_object('id',v_id,'caja_id',p_caja_id,'desde',null,'hasta',v_hasta,'cant_ventas',v_cant,'total',v_total,
    'total_efectivo',v_efec,'total_qr',v_qr,'total_tarjeta',v_tar,'total_transferencia',v_transf,
    'efectivo_contado',p_efectivo_contado,'diferencia',v_dif);
end $$;
grant execute on function public.cerrar_caja(text, numeric) to authenticated;

create or replace function public.metricas_periodo(p_desde timestamptz, p_hasta timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_total numeric(16,2); v_cant integer; v_margen numeric(16,2);
  v_efec numeric(16,2); v_qr numeric(16,2); v_tar numeric(16,2); v_transf numeric(16,2);
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select coalesce(sum(total),0), count(*) into v_total, v_cant
  from public.ventas where estado='activa' and creada_en >= p_desde and creada_en < p_hasta;
  select
    coalesce(sum(vp.monto) filter (where vp.medio_pago='efectivo'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='qr'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='tarjeta'),0),
    coalesce(sum(vp.monto) filter (where vp.medio_pago='transferencia'),0)
  into v_efec, v_qr, v_tar, v_transf
  from public.venta_pagos vp join public.ventas ve on ve.id = vp.venta_id
  where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta;
  select coalesce(sum((vi.precio_unit - vi.costo_unit) * vi.cantidad), 0) into v_margen
  from public.venta_items vi join public.ventas ve on ve.id = vi.venta_id
  where ve.estado='activa' and ve.creada_en >= p_desde and ve.creada_en < p_hasta and vi.costo_unit is not null;
  return jsonb_build_object('total',v_total,'cant_tickets',v_cant,'efectivo',v_efec,'qr',v_qr,'tarjeta',v_tar,'transferencia',v_transf,
    'margen',v_margen,'anulaciones',(select count(*) from public.ventas where estado='anulada' and anulada_en >= p_desde and anulada_en < p_hasta));
end $$;
grant execute on function public.metricas_periodo(timestamptz, timestamptz) to authenticated;

-- listar_ventas: incluir es_mixto para mostrar "Mixto" en la lista.
create or replace function public.listar_ventas(p_limite integer default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.creada_en desc), '[]'::jsonb) into v from (
    select ve.id, ve.ticket_nro, ve.creada_en, ve.medio_pago, ve.es_mixto, ve.total, ve.estado, ve.cierre_id, u.nombre as empleado_nombre
    from public.ventas ve
    left join public.usuarios u on u.id = ve.empleado_id
    order by ve.creada_en desc limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.listar_ventas(integer) to authenticated;
