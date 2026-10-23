import { createBrowserClient } from "@supabase/ssr";
import {
  SUPPORT_AUTH_COOKIE,
  SUPPORT_MODE_COOKIE,
} from "@/lib/auth/support-mode";
import { env, requireEnv } from "@/lib/env";
import type { Database } from "./database.current.types";

function browserSupportMode() {
  if (typeof document === "undefined") return false;

  return document.cookie
    .split(";")
    .map((item) => item.trim())
    .some((item) => item === `${SUPPORT_MODE_COOKIE}=1`);
}

export function createClient() {
  const supportMode = browserSupportMode();

  return createBrowserClient<Database>(
    requireEnv(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv(env.supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    supportMode
      ? { cookieOptions: { name: SUPPORT_AUTH_COOKIE } }
      : undefined,
  );
}
