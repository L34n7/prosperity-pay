import { createBrowserClient } from "@supabase/ssr";
import { env, requireEnv } from "@/lib/env";

export function createClient() {
  return createBrowserClient(
    requireEnv(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv(env.supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}
