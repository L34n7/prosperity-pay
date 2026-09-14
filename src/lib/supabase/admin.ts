import { createClient } from "@supabase/supabase-js";
import { env, requireEnv } from "@/lib/env";
import type { Database } from "./database.current.types";

export function createAdminClient() {
  const adminKey = env.supabaseServiceRoleKey ?? env.supabaseSecretKey;

  return createClient<Database>(
    requireEnv(env.supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv(adminKey, "SUPABASE_SERVICE_ROLE_KEY ou SUPABASE_SECRET_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
