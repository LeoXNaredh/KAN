import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PAGE_PATHS = ["/login", "/signup", "/auth/callback"];

/**
 * Refresca la sesión de Supabase en cada request y protege las páginas del
 * shell (ADR-017, docs/00). Las rutas de /api/* nunca se redirigen aquí —
 * un fetch() del cliente no debe recibir un 307 a una página HTML de login,
 * eso rompería `response.json()`; quedan a criterio de cada route handler.
 *
 * Convención "proxy" (reemplaza a "middleware", deprecado en Next 16 — ver
 * https://nextjs.org/docs/app/api-reference/file-conventions/proxy).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Sin credenciales configuradas todavía (antes de que el usuario cree su
  // proyecto de Supabase): no bloquear el dev server con un 500, dejar
  // pasar — /login y /signup mostrarán el error real al enviar el formulario.
  if (!supabaseUrl || !supabaseAnonKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  const isApiPath = pathname.startsWith("/api/");
  const isPublicPagePath = PUBLIC_PAGE_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isApiPath && !isPublicPagePath) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (user && (pathname === "/login" || pathname === "/signup")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
