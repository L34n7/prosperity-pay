import { createClient } from "@supabase/supabase-js";
import { env, requireEnv } from "@/lib/env";
import type { Database } from "./database.current.types";

export function createAdminClient() {
  return createClient<Database>(
    requireEnv(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv(env.supabaseServiceRoleKey, "SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
