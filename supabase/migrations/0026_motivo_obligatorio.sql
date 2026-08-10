-- ============================================================================
-- El motivo de la anulación pasa a ser OBLIGATORIO.
-- Sin esto, el aviso a los dueños llega vacío o con un texto fijo y no sirve
-- para nada ("Cancelada en el momento" en todas). Se exige en la base para que
-- no dependa de la pantalla desde la que se anule.
-- Idempotente.
-- ============================================================================

create or replace function public.anular_venta(p_venta_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ticket bigint; v_estado public.estado_venta; v_total numeric(12,2); v_cierre uuid; v_fact text;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'Hay que escribir el motivo de la anulación';
  end if;

  select ticket_nro, estado, total, cierre_id
  into v_ticket, v_estado, v_total, v_cierre
  from public.ventas where id = p_venta_id for update;
  if not found then raise exception 'Venta no encontrada'; end if;
  if v_estado <> 'activa' then raise exception 'La venta ya no está activa'; end if;
  if v_cierre is not null then
    raise exception 'La venta ya está en un cierre; no se puede anular';
  end if;

  select tipo into v_fact from public.comprobantes
  where venta_id = p_venta_id and estado = 'emitido' limit 1;
  if v_fact is not null then
    raise exception 'La venta tiene Factura % emitida: no se puede anular (hace falta nota de crédito)', v_fact;
  end if;

  update public.ventas
  set estado='anulada', anulada_por=auth.uid(), anulada_en=now(), motivo_anulacion=v_motivo
  where id = p_venta_id;

  perform set_config('app.en_venta','on',true);
  update public.productos p set stock = p.stock + agg.cant
  from (select producto_id, sum(cantidad) as cant from public.venta_items
        where venta_id = p_venta_id and producto_id is not null group by producto_id) agg
  where p.id = agg.producto_id;

  insert into public.eventos_duenos (tipo, venta_id, ticket_nro, empleado_id, detalle)
  values ('anulacion', p_venta_id, v_ticket, auth.uid(), v_motivo);

  return jsonb_build_object('id',p_venta_id,'ticket_nro',v_ticket,'estado','anulada','total',v_total);
end $$;
grant execute on function public.anular_venta(uuid, text) to authenticated;
