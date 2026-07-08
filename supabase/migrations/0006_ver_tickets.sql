-- ============================================================================
-- Fase 3 (extra) — Ver tickets: lista de ventas con el empleado que cobró.
-- listar_ventas (SECURITY DEFINER) une usuarios sin exponer su tabla por RLS.
-- Los ítems de cada ticket se leen directo de venta_items (RLS ya lo permite).
-- Idempotente.
-- ============================================================================

create or replace function public.listar_ventas(p_limite integer default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.creada_en desc), '[]'::jsonb)
  into v
  from (
    select ve.id, ve.ticket_nro, ve.creada_en, ve.medio_pago, ve.total,
           ve.estado, ve.cierre_id, u.nombre as empleado_nombre
    from public.ventas ve
    left join public.usuarios u on u.id = ve.empleado_id
    order by ve.creada_en desc
    limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.listar_ventas(integer) to authenticated;
