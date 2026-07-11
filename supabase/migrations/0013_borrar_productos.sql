-- ============================================================================
-- Borrar / desactivar productos para EMPLEADOS y ADMINS.
--  - Desactivar/reactivar = update de `activo` → ya lo permite productos_update
--    (es_usuario). Acá solo se AUDITA el cambio de `activo`.
--  - Borrado definitivo (delete) = antes solo admin; ahora cualquier usuario
--    provisionado. Se AUDITA el borrado (queda quién y qué borró).
-- El historial de ventas se conserva: venta_items.producto_id es ON DELETE SET
-- NULL y guarda copia de codigo/descripcion/precio de cada renglón.
-- Idempotente.
-- ============================================================================

-- 1) Permiso de borrado: empleados + admins.
drop policy if exists productos_delete_admin on public.productos;
drop policy if exists productos_delete on public.productos;
create policy productos_delete on public.productos
  for delete to authenticated using (public.es_usuario());

-- 2) Auditar también el cambio de `activo` (desactivar/reactivar), además de
--    precio_venta / precio_costo / stock.
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
  if new.activo is distinct from old.activo then
    insert into public.auditoria (entidad, entidad_id, campo, valor_ant, valor_nuevo, usuario_id)
    values ('productos', new.id, 'activo', old.activo::text, new.activo::text, auth.uid());
  end if;
  return null;
end $$;

-- 3) Auditar el borrado definitivo (AFTER DELETE): guarda código + descripción
--    del producto borrado y quién lo borró.
create or replace function public.productos_auditar_borrado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.en_venta', true) = 'on' then return old; end if;
  insert into public.auditoria (entidad, entidad_id, campo, valor_ant, valor_nuevo, usuario_id)
  values ('productos', old.id, 'borrado',
          coalesce(old.codigo, '') || ' · ' || coalesce(old.descripcion, ''), null, auth.uid());
  return old;
end $$;

drop trigger if exists productos_auditar_borrado on public.productos;
create trigger productos_auditar_borrado
  after delete on public.productos
  for each row execute function public.productos_auditar_borrado();
