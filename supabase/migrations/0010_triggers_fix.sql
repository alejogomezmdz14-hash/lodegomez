-- ============================================================================
-- FIX: los triggers de productos no estaban adjuntados en la base, así que los
-- cambios de precio/costo/stock NO se auditaban ni seteaban modificado_por.
-- Se redefinen las funciones (versión actual) y se RE-ADJUNTAN los triggers.
-- Idempotente.
-- ============================================================================

create or replace function public.productos_guard_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.en_venta', true) = 'on' then
    new.modificado_por := old.modificado_por;
    new.modificado_en  := old.modificado_en;
    new.actualizado_en := now();
  else
    new.modificado_por := coalesce(auth.uid(), old.modificado_por);
    new.modificado_en  := now();
    new.actualizado_en := now();
  end if;
  return new;
end $$;

create or replace function public.productos_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.en_venta', true) = 'on' then return null; end if;
  if new.precio_venta is distinct from old.precio_venta then
    insert into public.auditoria (entidad, entidad_id, campo, valor_ant, valor_nuevo, usuario_id)
    values ('productos', new.id, 'precio_venta', old.precio_venta::text, new.precio_venta::text, auth.uid());
  end if;
  if new.precio_costo is distinct from old.precio_costo then
    insert into public.auditoria (entidad, entidad_id, campo, valor_ant, valor_nuevo, usuario_id)
    values ('productos', new.id, 'precio_costo', old.precio_costo::text, new.precio_costo::text, auth.uid());
  end if;
  if new.stock is distinct from old.stock then
    insert into public.auditoria (entidad, entidad_id, campo, valor_ant, valor_nuevo, usuario_id)
    values ('productos', new.id, 'stock', old.stock::text, new.stock::text, auth.uid());
  end if;
  return null;
end $$;

-- RE-ADJUNTAR (esto es lo que faltaba).
drop trigger if exists productos_guard_update on public.productos;
create trigger productos_guard_update
  before update on public.productos
  for each row execute function public.productos_guard_update();

drop trigger if exists productos_auditar on public.productos;
create trigger productos_auditar
  after update on public.productos
  for each row execute function public.productos_auditar();
