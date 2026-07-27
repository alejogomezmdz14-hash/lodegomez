-- ============================================================================
-- Fixes de la auditoría end-to-end.
--  (A) anular_venta: bloquear si la venta ya tiene factura EMITIDA (con CAE).
--      Anularla dejaba la factura viva en ARCA, sin nota de crédito, y la plata
--      desaparecía del cierre y de las métricas.
--  (B) Egresos: hoy se atribuyen SIEMPRE a quien los tipea (default auth.uid()).
--      Si el dueño saca plata del cajón del cajero, al cajero le queda un
--      faltante falso. Ahora un admin puede indicar DE QUÉ CAJA sale, y se
--      registra aparte quién lo cargó (auditoría).
--  (C) cajas_abiertas(): incluir a quien tenga egresos pendientes aunque no
--      tenga ventas, para que esa caja sea visible y cerrable (si no, el egreso
--      queda huérfano y estalla en un cierre muy posterior).
-- Idempotente.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) anular_venta: no anular ventas ya facturadas
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.anular_venta(p_venta_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ticket bigint; v_estado public.estado_venta; v_total numeric(12,2); v_cierre uuid; v_fact text;
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

  -- Factura ya emitida: anular acá dejaría el comprobante autorizado en ARCA sin
  -- respaldo. Corresponde nota de crédito (fuera del alcance del sistema hoy).
  select tipo into v_fact from public.comprobantes
  where venta_id = p_venta_id and estado = 'emitido' limit 1;
  if v_fact is not null then
    raise exception 'La venta tiene Factura % emitida: no se puede anular (hace falta nota de crédito)', v_fact;
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

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) Egresos: separar "de qué caja sale" (empleado_id) de "quién lo cargó"
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.movimientos_caja
  add column if not exists registrado_por uuid references public.usuarios (id) on delete set null;

-- Los ya existentes: los cargó el mismo al que se le atribuyeron.
update public.movimientos_caja set registrado_por = empleado_id where registrado_por is null;

alter table public.movimientos_caja alter column registrado_por set default auth.uid();

-- Insertar: uno mismo siempre; a la caja de otro, solo el admin.
drop policy if exists movimientos_insert on public.movimientos_caja;
create policy movimientos_insert on public.movimientos_caja
  for insert to authenticated with check (
    public.es_usuario()
    and registrado_por = auth.uid()
    and (empleado_id = auth.uid() or public.es_admin())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- (C) cajas_abiertas(): sumar las cajas que solo tienen egresos pendientes
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cajas_abiertas()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.es_admin() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.nombre), '[]'::jsonb) into v from (
    with abiertos as (
      select empleado_id from public.ventas
        where estado='activa' and cierre_id is null and empleado_id is not null
      union
      select empleado_id from public.movimientos_caja
        where cierre_id is null and empleado_id is not null
    )
    select a.empleado_id,
           coalesce(u.nombre, 'Sin nombre') as nombre,
           coalesce(count(ve.id), 0) as cant,
           coalesce(sum(ve.total), 0) as total
    from abiertos a
    left join public.usuarios u on u.id = a.empleado_id
    left join public.ventas ve
      on ve.empleado_id = a.empleado_id and ve.estado='activa' and ve.cierre_id is null
    group by a.empleado_id, u.nombre
  ) r;
  return v;
end $$;
grant execute on function public.cajas_abiertas() to authenticated;

-- Listado de egresos: mostrar también quién lo cargó (si difiere de la caja).
create or replace function public.listar_egresos(p_limite integer default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.creada_en desc), '[]'::jsonb)
  into v
  from (
    select m.id, m.tipo, m.medio_pago, m.monto, m.detalle, m.cierre_id, m.creada_en,
           u.nombre as empleado_nombre,
           r2.nombre as registrado_por_nombre
    from public.movimientos_caja m
    left join public.usuarios u on u.id = m.empleado_id
    left join public.usuarios r2 on r2.id = m.registrado_por
    order by m.creada_en desc
    limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.listar_egresos(integer) to authenticated;
