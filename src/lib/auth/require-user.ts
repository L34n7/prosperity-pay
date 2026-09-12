import { HttpError } from "@/lib/api/http";
import { createClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    throw new HttpError(401, "Autenticacao obrigatoria.");
  }

  return { supabase, user: data.user };
}

export async function requireFinanceAdmin() {
  const context = await requireUser();
  const { data, error } = await context.supabase.rpc("is_finance_admin");
  if (error || !data) throw new HttpError(403, "Acesso administrativo necessario.");
  return context;
}
