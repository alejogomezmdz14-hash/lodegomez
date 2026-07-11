-- ============================================================================
-- FIX: poder dar de baja un empleado que YA tocó el catálogo.
-- Hoy, borrar un empleado que alguna vez modificó un precio/costo/stock falla con
--   23503: "...violates foreign key constraint productos_modificado_por_fkey..."
-- porque en la base viva estas FK quedaron como NO ACTION (no on delete set null),
-- pese a lo que declara 0001. Se re-declaran como ON DELETE SET NULL: al borrar al
-- usuario, productos.modificado_por / auditoria.usuario_id quedan en null y se
-- conserva la historia. Idempotente.
-- ============================================================================

alter table public.productos drop constraint if exists productos_modificado_por_fkey;
alter table public.productos
  add constraint productos_modificado_por_fkey
  foreign key (modificado_por) references public.usuarios (id) on delete set null;

alter table public.auditoria drop constraint if exists auditoria_usuario_id_fkey;
alter table public.auditoria
  add constraint auditoria_usuario_id_fkey
  foreign key (usuario_id) references public.usuarios (id) on delete set null;
