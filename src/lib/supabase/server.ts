import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  SUPPORT_AUTH_COOKIE,
  SUPPORT_MODE_COOKIE,
  isSupportModeValue,
} from "@/lib/auth/support-mode";
import { env, requireEnv } from "@/lib/env";
import type { Database } from "./database.current.types";

export async function createClient(options?: { forcePrimary?: boolean }) {
  const cookieStore = await cookies();
  const supportMode =
    !options?.forcePrimary &&
    isSupportModeValue(cookieStore.get(SUPPORT_MODE_COOKIE)?.value);

  return createServerClient<Database>(
    requireEnv(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv(env.supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      ...(supportMode
        ? { cookieOptions: { name: SUPPORT_AUTH_COOKIE } }
        : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components podem executar em contexto somente leitura.
          }
        },
      },
    },
  );
}
