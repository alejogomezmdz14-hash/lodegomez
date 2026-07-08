import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refresca la sesión de Supabase en cada request y protege /admin/*.
// Es defensivo: si faltan las variables de entorno o Supabase falla, deja
// pasar la request en lugar de tirar abajo todo el sitio.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const path = request.nextUrl.pathname;
    const esPublica = path === "/ingresar" || path.startsWith("/ingresar/");

    // Sin sesión, solo se permite el login: todo el resto va a /ingresar.
    if (!user && !esPublica) {
      return redirigir(request, response, "/ingresar");
    }

    // Candado del panel de administración: además del login, rol 'admin'.
    if (user && path.startsWith("/admin")) {
      const { data: perfil } = await supabase
        .from("usuarios")
        .select("rol")
        .eq("id", user.id)
        .single();

      if (perfil?.rol !== "admin") {
        return redirigir(request, response, "/ingresar", "sinAcceso=1");
      }
    }

    return response;
  } catch {
    // No bloquear la request si Supabase no responde.
    return response;
  }
}

// Redirige preservando las cookies de sesión que pudo refrescar getUser().
function redirigir(
  request: NextRequest,
  response: NextResponse,
  pathname: string,
  search = "",
) {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  url.search = search;
  const redirectRes = NextResponse.redirect(url);
  response.cookies.getAll().forEach((cookie) => redirectRes.cookies.set(cookie));
  return redirectRes;
}
