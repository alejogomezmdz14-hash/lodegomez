# Panel de admin + login — Diseño (2026-07-07)

## Objetivo
Dar acceso autenticado al sistema y la primera pantalla de administración:
**gestión de empleados** (crear / listar / cambiar rol / borrar), conectada a las
Server Actions ya construidas (`crearUsuario`, `listarUsuarios`, `cambiarRol`,
`borrarUsuario`). Es la base sobre la que después crecen Dashboard, Productos y POS.

## Alcance (esta iteración)
- Pantalla de **login** (email + contraseña, Supabase Auth).
- **Protección de rutas** por sesión y rol (admin), en el middleware.
- **Shell** del panel `/admin` con navegación lateral (solo "Empleados" por ahora)
  y botón de cerrar sesión.
- Pantalla **`/admin/empleados`**: lista + alta + cambio de rol + baja.

**Fuera de alcance (YAGNI por ahora):** recuperación de contraseña, shadcn/ui,
branding/logo, otros módulos, PWA. Se suman más adelante.

## Rutas
- `/ingresar` — login. Con sesión activa → redirige a `/admin`.
- `/admin` — redirige a `/admin/empleados` (única sección por ahora).
- `/admin/empleados` — gestión de empleados (solo admin).

## Auth y roles (middleware)
`src/lib/supabase/middleware.ts` ya refresca la sesión. Se extiende para gatear:
- `/admin/*`: sin `user` → redirect a `/ingresar`; con `user` pero rol ≠ admin →
  redirect a `/ingresar?sinAcceso=1`.
- `/ingresar`: con sesión activa → redirect a `/admin`.
- El rol se lee de `public.usuarios` (consulta liviana). Defensa en profundidad:
  las Server Actions ya validan con `requireAdmin()` y la RLS protege la DB; el
  middleware es el candado de UX, no la única barrera.

## Archivos nuevos
- `src/app/ingresar/page.tsx` — server page; si hay sesión, redirect a `/admin`.
- `src/app/ingresar/login-form.tsx` — client component (email+password) que llama a
  `iniciarSesion`; muestra errores en español.
- `src/lib/actions/auth.ts` — `iniciarSesion({email,password})` y `cerrarSesion()`
  (server actions con el server client de Supabase, que setean/limpian cookies).
- `src/app/admin/layout.tsx` — shell: sidebar (Empleados) + header con nombre del
  admin y "Cerrar sesión". Server component; usa `getUsuarioActual()`.
- `src/app/admin/page.tsx` — redirect a `/admin/empleados`.
- `src/app/admin/empleados/page.tsx` — server page: `listarUsuarios()` → tabla.
- `src/app/admin/empleados/empleados-cliente.tsx` — client component: tabla +
  acciones (form de alta, cambiar rol, borrar con confirmación) que llaman a las
  Server Actions y refrescan con `router.refresh()`.

## Flujo de datos
- **Login**: form → `iniciarSesion` (server) → cookies de sesión → redirect `/admin`.
- **Empleados**: page server llama `listarUsuarios()` → props al cliente. Alta / rol
  / baja → server actions → `router.refresh()` re-lee la lista.

## Errores
- Login inválido → "Email o contraseña incorrectos" (sin decir cuál falló).
- Alta: email repetido / contraseña corta → mensaje claro de la action.
- No podés borrarte ni quitarte admin a vos mismo → ya bloqueado en las actions; el
  UI además oculta esas acciones en tu propia fila.

## Estilo
Tailwind plano, alto contraste, botones grandes (coherente con el POS que viene).
Paleta verde fresco + blanco/negro. Sin shadcn ni logo todavía.

## Verificación
- Manual: login OK/inválido; `/admin` sin sesión redirige; empleado (no admin) no
  entra; alta/rol/baja se reflejan en la lista.
- `pnpm exec tsc --noEmit` y `pnpm build` en verde.
