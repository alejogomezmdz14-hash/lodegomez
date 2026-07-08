-- ============================================================================
-- Fase 2 (fix) — Cierre por "tag": cada venta se marca con el cierre que la
-- contabilizó (ventas.cierre_id). Reemplaza la ventana por timestamp, que bajo
-- concurrencia doble-contaba y perdía ventas que commitean tarde.
-- Idempotente. Correr DESPUÉS de 0003_caja.sql.
-- ============================================================================

alter table public.ventas
  add column if not exists cierre_id uuid references public.cierres_caja (id) on delete set null;
-- Índice parcial: acelera "ventas del turno abierto" (cierre_id null).
create index if not exists ventas_abiertas_idx on public.ventas (caja_id) where cierre_id is null;

-- Turno abierto = ventas activas todavía sin cierre.
create or replace function public.resumen_caja_actual(p_caja_id text default 'principal')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_total numeric(12,2); v_efec numeric(12,2); v_qr numeric(12,2);
  v_tar numeric(12,2); v_transf numeric(12,2); v_cant integer;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(sum(total),0),
    coalesce(sum(total) filter (where medio_pago='efectivo'),0),
    coalesce(sum(total) filter (where medio_pago='qr'),0),
    coalesce(sum(total) filter (where medio_pago='tarjeta'),0),
    coalesce(sum(total) filter (where medio_pago='transferencia'),0),
    count(*)
  into v_total, v_efec, v_qr, v_tar, v_transf, v_cant
  from public.ventas
  where caja_id = p_caja_id and estado='activa' and cierre_id is null;
  return jsonb_build_object('caja_id',p_caja_id,'desde',null,'hasta',now(),
    'cant_ventas',v_cant,'total',v_total,'total_efectivo',v_efec,'total_qr',v_qr,
    'total_tarjeta',v_tar,'total_transferencia',v_transf);
end $$;
grant execute on function public.resumen_caja_actual(text) to authenticated;

-- Cierre atómico: advisory lock (serializa cierres del mismo caja) + reclamar
-- (tag) las ventas abiertas en una sola UPDATE. Dos cierres simultáneos no
-- pueden reclamar la misma venta => no hay doble-conteo.
create or replace function public.cerrar_caja(
  p_caja_id text default 'principal', p_efectivo_contado numeric default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_hasta timestamptz := now();
  v_total numeric(12,2); v_efec numeric(12,2); v_qr numeric(12,2);
  v_tar numeric(12,2); v_transf numeric(12,2); v_cant integer; v_dif numeric(12,2);
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  if p_efectivo_contado is not null and p_efectivo_contado < 0 then
    raise exception 'El efectivo contado no puede ser negativo';
  end if;

  perform pg_advisory_xact_lock(hashtext('cerrar_caja:' || p_caja_id)::bigint);

  insert into public.cierres_caja (empleado_id, caja_id, hasta)
  values (auth.uid(), p_caja_id, v_hasta) returning id into v_id;

  with reclamadas as (
    update public.ventas set cierre_id = v_id
    where caja_id = p_caja_id and estado='activa' and cierre_id is null
    returning total, medio_pago
  )
  select coalesce(sum(total),0),
    coalesce(sum(total) filter (where medio_pago='efectivo'),0),
    coalesce(sum(total) filter (where medio_pago='qr'),0),
    coalesce(sum(total) filter (where medio_pago='tarjeta'),0),
    coalesce(sum(total) filter (where medio_pago='transferencia'),0),
    count(*)
  into v_total, v_efec, v_qr, v_tar, v_transf, v_cant
  from reclamadas;

  v_dif := case when p_efectivo_contado is null then null else round(p_efectivo_contado - v_efec, 2) end;

  update public.cierres_caja
  set cant_ventas=v_cant, total=v_total, total_efectivo=v_efec, total_qr=v_qr,
      total_tarjeta=v_tar, total_transferencia=v_transf,
      efectivo_contado=p_efectivo_contado, diferencia=v_dif
  where id = v_id;

  return jsonb_build_object('id',v_id,'caja_id',p_caja_id,'desde',null,'hasta',v_hasta,
    'cant_ventas',v_cant,'total',v_total,'total_efectivo',v_efec,'total_qr',v_qr,
    'total_tarjeta',v_tar,'total_transferencia',v_transf,
    'efectivo_contado',p_efectivo_contado,'diferencia',v_dif);
end $$;
grant execute on function public.cerrar_caja(text, numeric) to authenticated;

-- Anular: no se puede si la venta ya fue contabilizada en un cierre (evita
-- descuadrar un cierre histórico).
create or replace function public.anular_venta(p_venta_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ticket bigint; v_estado public.estado_venta; v_total numeric(12,2); v_cierre uuid;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select ticket_nro, estado, total, cierre_id
  into v_ticket, v_estado, v_total, v_cierre
  from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_estado <> 'activa' then raise exception 'La venta ya no está activa'; end if;
  if v_cierre is not null then
    raise exception 'La venta ya está en un cierre; no se puede anular';
  end if;

  update public.ventas
  set estado='anulada', anulada_por=auth.uid(), anulada_en=now(), motivo_anulacion=p_motivo
  where id = p_venta_id;

  perform set_config('app.en_venta','on',true);
  update public.productos p set stock = p.stock + agg.cant
  from (select producto_id, sum(cantidad) as cant from public.venta_items
        where venta_id = p_venta_id and producto_id is not null group by producto_id) agg
  where p.id = agg.producto_id;

  insert into public.eventos_duenos (tipo, venta_id, ticket_nro, empleado_id, detalle)
  values ('anulacion', p_venta_id, v_ticket, auth.uid(), coalesce(p_motivo,''));

  return jsonb_build_object('id',p_venta_id,'ticket_nro',v_ticket,'estado','anulada','total',v_total);
end $$;
grant execute on function public.anular_venta(uuid, text) to authenticated;
