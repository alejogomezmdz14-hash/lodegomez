-- ============================================================================
-- Fase 1 — Lo De Gómez: catálogo, usuarios/roles y auditoría
-- Revisado (Postgres 15 + RLS Supabase). Correr en el SQL Editor de Supabase.
-- Es idempotente: se puede correr más de una vez sin error.
--
-- Modelo de seguridad: los usuarios los crea ÚNICAMENTE el admin (no hay alta
-- automática en signup). Solo un usuario "provisionado" (con fila en public.usuarios)
-- accede a los datos del negocio. Igual conviene desactivar el registro público en
-- Authentication (ver bloque al final).
-- ============================================================================

-- === Extensiones ===
create extension if not exists pg_trgm;      -- búsqueda por descripción

-- === Rol de usuario ===
do $$ begin
  create type public.rol_usuario as enum ('empleado', 'admin');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- usuarios: perfil ligado a auth.users. auth.uid() = usuarios.id
-- ============================================================================
create table if not exists public.usuarios (
  id         uuid primary key references auth.users (id) on delete cascade,
  nombre     text,
  rol        public.rol_usuario not null default 'empleado',
  creado_en  timestamptz not null default now()
);
alter table public.usuarios enable row level security;

-- Rol del usuario actual. security definer + owner = postgres: el SELECT interno
-- corre como owner de usuarios y omite la RLS de esa tabla (no recursa).
create or replace function public.rol_actual()
returns public.rol_usuario
language sql stable security definer set search_path = public as $$
  select rol from public.usuarios where id = auth.uid();
$$;

create or replace function public.es_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.rol_actual() = 'admin', false);
$$;

-- Usuario "provisionado": tiene fila en public.usuarios (lo dio de alta el admin).
-- Como NO hay alta automática en signup, alguien que se autoregistrara con la
-- anon key no tendría fila y las policies no le darían acceso a nada del negocio.
create or replace function public.es_usuario()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios where id = auth.uid());
$$;

drop policy if exists usuarios_select on public.usuarios;
create policy usuarios_select on public.usuarios
  for select to authenticated using (id = auth.uid() or public.es_admin());

drop policy if exists usuarios_admin_all on public.usuarios;
create policy usuarios_admin_all on public.usuarios
  for all to authenticated using (public.es_admin()) with check (public.es_admin());

-- SIN alta automática en signup: los usuarios los crea únicamente el admin
-- (Server Action crearUsuario / script crear-admin.mjs), que inserta la fila en
-- public.usuarios explícitamente. Se elimina el trigger histórico si existiera.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- ============================================================================
-- productos: catálogo (migrado desde STOCK.DBF)
-- ============================================================================
create table if not exists public.productos (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text unique not null,          -- EAN-13 o código interno
  descripcion          text,
  rubro                text,                           -- rubro normalizado
  rubro_original       text,                           -- rubro tal cual venía en el DBF
  precio_costo         numeric(12,2),
  precio_venta         numeric(12,2),
  margen_pct           numeric(12,2),                  -- calculado (venta-costo)/costo*100; puede ser enorme si el costo es casi cero
  iva_pct              numeric(4,1) not null default 21,
  stock                numeric(12,3) not null default 0,
  stock_minimo         integer,                        -- null en pesables
  es_pesable           boolean not null default false, -- se vende por kg
  precio_por_kg        numeric(12,2),                  -- precio/kg si es pesable
  necesita_inventario  boolean not null default false, -- stock negativo: contar físico
  activo               boolean not null default true,
  modificado_por       uuid references public.usuarios (id),
  modificado_en        timestamptz,                    -- desde el DBF (campo COLOR)
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now()
);
create index if not exists productos_rubro_idx     on public.productos (rubro);
create index if not exists productos_desc_trgm_idx on public.productos using gin (descripcion gin_trgm_ops);

alter table public.productos enable row level security;

-- Lectura: solo usuarios provisionados (empleado o admin), no cualquier autenticado.
drop policy if exists productos_select on public.productos;
create policy productos_select on public.productos
  for select to authenticated using (public.es_usuario());

-- Modificación: usuarios provisionados. El trigger de más abajo limita al empleado
-- a precio_venta y stock; el admin puede todo.
drop policy if exists productos_update on public.productos;
create policy productos_update on public.productos
  for update to authenticated using (public.es_usuario()) with check (public.es_usuario());

-- Alta/baja de productos: solo admin.
drop policy if exists productos_insert_admin on public.productos;
create policy productos_insert_admin on public.productos
  for insert to authenticated with check (public.es_admin());

drop policy if exists productos_delete_admin on public.productos;
create policy productos_delete_admin on public.productos
  for delete to authenticated using (public.es_admin());

-- ============================================================================
-- auditoría: toda modificación de precio/stock (usuario + timestamp + antes/después)
-- La escribe un trigger (más abajo); no depende de que el cliente la registre.
-- ============================================================================
create table if not exists public.auditoria (
  id           bigint generated always as identity primary key,
  entidad      text not null,          -- 'productos'
  entidad_id   uuid not null,
  campo        text not null,          -- 'precio_venta' | 'precio_costo' | 'stock'
  valor_ant    text,
  valor_nuevo  text,
  usuario_id   uuid references public.usuarios (id),
  fecha_hora   timestamptz not null default now()
);
create index if not exists auditoria_entidad_idx on public.auditoria (entidad, entidad_id);
alter table public.auditoria enable row level security;

-- La auditoría la ve solo el admin.
drop policy if exists auditoria_select_admin on public.auditoria;
create policy auditoria_select_admin on public.auditoria
  for select to authenticated using (public.es_admin());

-- Inserción: NO se permite desde clientes. La auditoría la escribe únicamente el
-- trigger productos_auditar (security definer, corre como owner y omite RLS), así
-- nadie puede forjar ni inundar el registro de auditoría.
drop policy if exists auditoria_insert on public.auditoria;

-- ============================================================================
-- FKs hacia usuarios con ON DELETE SET NULL: así se puede dar de baja un
-- empleado que ya tocó el catálogo, conservando la historia de auditoría.
-- ============================================================================
alter table public.productos drop constraint if exists productos_modificado_por_fkey;
alter table public.productos add constraint productos_modificado_por_fkey
  foreign key (modificado_por) references public.usuarios (id) on delete set null;

alter table public.auditoria drop constraint if exists auditoria_usuario_id_fkey;
alter table public.auditoria add constraint auditoria_usuario_id_fkey
  foreign key (usuario_id) references public.usuarios (id) on delete set null;

-- ============================================================================
-- Triggers de productos (van al final: la auditoría inserta en public.auditoria)
-- ============================================================================

-- BEFORE UPDATE: setea metadata de modificación y limita al empleado a
-- precio_venta y stock (congela el resto). auth.uid() nulo = servicio/SQL Editor.
create or replace function public.productos_guard_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.es_admin() then
    new.codigo         := old.codigo;
    new.descripcion    := old.descripcion;
    new.rubro          := old.rubro;
    new.rubro_original := old.rubro_original;
    new.precio_costo   := old.precio_costo;
    new.margen_pct     := old.margen_pct;
    new.iva_pct        := old.iva_pct;
    new.stock_minimo   := old.stock_minimo;
    new.es_pesable     := old.es_pesable;
    new.precio_por_kg  := old.precio_por_kg;
    new.activo         := old.activo;
  end if;
  new.modificado_por := coalesce(auth.uid(), old.modificado_por);
  new.modificado_en  := now();
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists productos_set_updated on public.productos;
drop trigger if exists productos_guard_update on public.productos;
create trigger productos_guard_update
  before update on public.productos
  for each row execute function public.productos_guard_update();

-- AFTER UPDATE: registra en auditoría cada cambio de precio o stock, con auth.uid().
create or replace function public.productos_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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

drop trigger if exists productos_auditar on public.productos;
create trigger productos_auditar
  after update on public.productos
  for each row execute function public.productos_auditar();

-- ============================================================================
-- DESPUÉS DE APLICAR — pasos manuales:
--
-- 1) (Defensa extra) Desactivar registro público: Dashboard → Authentication →
--    Sign In / Providers → apagar "Allow new users to sign up".
--
-- 2) Promover admin(s) (registrate/creá el usuario primero, después):
--    update public.usuarios u set rol = 'admin'
--    from auth.users au
--    where au.id = u.id and au.email in ('alejogomez.mdz14@gmail.com');
--
-- 3) Verificar:  select au.email, u.rol from public.usuarios u
--                join auth.users au on au.id = u.id order by u.rol;
-- ============================================================================
