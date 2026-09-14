import { HttpError } from "@/lib/api/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function ensureInitialPlatformAdmin(userId: string) {
  const admin = createAdminClient();
  const { data: currentRole, error: currentRoleError } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (currentRoleError) throw currentRoleError;
  if (currentRole) return true;

  const { data: existingAdmin, error: existingAdminError } = await admin
    .from("user_roles")
    .select("user_id")
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  if (existingAdminError) throw existingAdminError;
  if (existingAdmin) return false;

  const { data: firstProfile, error: firstProfileError } = await admin
    .from("profiles")
    .select("id")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (firstProfileError) throw firstProfileError;
  if (!firstProfile || firstProfile.id !== userId) return false;

  const { error: insertError } = await admin.from("user_roles").insert({
    user_id: userId,
    role: "admin",
    granted_by: userId,
  });
  if (insertError && insertError.code !== "23505") throw insertError;
  return true;
}

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
  await ensureInitialPlatformAdmin(context.user.id);
  const { data, error } = await context.supabase.rpc("is_finance_admin");
  if (error || !data) throw new HttpError(403, "Acesso administrativo necessario.");
  return context;
}

export async function requirePlatformAdmin() {
  const context = await requireUser();
  const authorized = await ensureInitialPlatformAdmin(context.user.id);
  if (!authorized) throw new HttpError(403, "Acesso exclusivo do administrador da plataforma.");
  return context;
}
