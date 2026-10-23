import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  SUPPORT_AUTH_COOKIE,
  SUPPORT_MODE_COOKIE,
  isSupportModeValue,
} from "@/lib/auth/support-mode";
import { env } from "@/lib/env";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function clearSupportCookies(request: NextRequest, response: NextResponse) {
  response.cookies.set(SUPPORT_MODE_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });

  request.cookies
    .getAll()
    .filter(({ name }) => name.startsWith(SUPPORT_AUTH_COOKIE))
    .forEach(({ name }) => {
      response.cookies.set(name, "", { path: "/", maxAge: 0 });
    });
}

export async function proxy(request: NextRequest) {
  if (!env.supabaseUrl || !env.supabaseAnonKey) return NextResponse.next();

  const supportMode = isSupportModeValue(
    request.cookies.get(SUPPORT_MODE_COOKIE)?.value,
  );

  if (
    supportMode &&
    !SAFE_METHODS.has(request.method.toUpperCase()) &&
    request.nextUrl.pathname !== "/api/support/exit"
  ) {
    return NextResponse.json(
      {
        error:
          "Modo suporte é somente leitura. Saia do modo suporte para realizar alterações.",
      },
      { status: 403 },
    );
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    ...(supportMode
      ? { cookieOptions: { name: SUPPORT_AUTH_COOKIE } }
      : {}),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookies, headers) => {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        Object.entries(headers).forEach(([key, value]) =>
          response.headers.set(key, value),
        );
      },
    },
  });

  const { data, error } = await supabase.auth.getClaims();

  if (supportMode && (error || !data?.claims)) {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/usuarios";
    url.search = "?suporte=expirado";
    const expired = NextResponse.redirect(url);
    clearSupportCookies(request, expired);
    return expired;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
