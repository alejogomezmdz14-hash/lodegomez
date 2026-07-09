-- ============================================================================
-- Catálogo: alta y edición de productos para CUALQUIER usuario provisionado
-- ("todos pueden todo", con auditoría). Idempotente.
-- ============================================================================

-- Alta de productos: cualquier usuario provisionado (antes era solo admin).
drop policy if exists productos_insert_admin on public.productos;
drop policy if exists productos_insert on public.productos;
create policy productos_insert on public.productos
  for insert to authenticated with check (public.es_usuario());

-- El trigger de UPDATE ya NO congela columnas (todos editan todo). Mantiene la
-- metadata de modificación y sigue sin auditar el descuento de stock por venta.
-- La auditoría de precio_venta/precio_costo/stock la hace productos_auditar.
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
