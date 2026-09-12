import { createBrowserClient } from "@supabase/ssr";
import { env, requireEnv } from "@/lib/env";
import type { Database } from "./database.types";

export function createClient() {
  return createBrowserClient<Database>(
    requireEnv(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv(env.supabaseAnonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  );
}
