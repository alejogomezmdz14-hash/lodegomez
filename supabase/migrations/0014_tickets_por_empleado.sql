-- ============================================================================
-- Cada empleado ve SOLO sus propios tickets; el admin ve todos.
-- Dos frentes: (1) RLS de ventas/venta_items/venta_pagos (el cliente los lee
-- directo), y (2) la RPC listar_ventas (security definer, filtra explícito).
-- El cierre de caja NO cambia: sigue siendo por caja física (security definer).
-- Idempotente.
-- ============================================================================

-- ventas: propio o admin
drop policy if exists ventas_select on public.ventas;
create policy ventas_select on public.ventas
  for select to authenticated
  using (public.es_admin() or empleado_id = auth.uid());

-- venta_items: seguir a la venta padre
drop policy if exists venta_items_select on public.venta_items;
create policy venta_items_select on public.venta_items
  for select to authenticated
  using (
    public.es_admin() or exists (
      select 1 from public.ventas v
      where v.id = venta_items.venta_id and v.empleado_id = auth.uid()
    )
  );

-- venta_pagos: idem
drop policy if exists venta_pagos_select on public.venta_pagos;
create policy venta_pagos_select on public.venta_pagos
  for select to authenticated
  using (
    public.es_admin() or exists (
      select 1 from public.ventas v
      where v.id = venta_pagos.venta_id and v.empleado_id = auth.uid()
    )
  );

-- listar_ventas: filtra por empleado salvo admin.
create or replace function public.listar_ventas(p_limite integer default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null or not public.es_usuario() then raise exception 'No autorizado'; end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.creada_en desc), '[]'::jsonb) into v from (
    select ve.id, ve.ticket_nro, ve.creada_en, ve.medio_pago, ve.es_mixto, ve.total, ve.estado, ve.cierre_id, u.nombre as empleado_nombre
    from public.ventas ve
    left join public.usuarios u on u.id = ve.empleado_id
    where public.es_admin() or ve.empleado_id = auth.uid()
    order by ve.creada_en desc limit greatest(p_limite, 1)
  ) r;
  return v;
end $$;
grant execute on function public.listar_ventas(integer) to authenticated;
