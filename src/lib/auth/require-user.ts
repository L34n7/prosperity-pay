import { HttpError } from "@/lib/api/http";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function ensureInitialPlatformAdmin(userId: string) {
  try {
    const admin = createAdminClient();
    const { data: currentRole, error: currentRoleError } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (currentRoleError) return false;
    if (currentRole) return true;

    const { data: existingAdmin, error: existingAdminError } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();
    if (existingAdminError || existingAdmin) return false;

    const { data: firstProfile, error: firstProfileError } = await admin
      .from("profiles")
      .select("id")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (firstProfileError || !firstProfile || firstProfile.id !== userId) return false;

    const { error: insertError } = await admin.from("user_roles").insert({
      user_id: userId,
      role: "admin",
      granted_by: userId,
    });

    if (insertError && insertError.code !== "23505") return false;

    await admin.from("audit_events").insert({
      actor_user_id: userId,
      action: "platform_admin.bootstrap",
      entity_type: "user_role",
      entity_id: userId,
      metadata: { role: "admin", reason: "initial_platform_owner" },
    }).then(() => undefined, () => undefined);

    const { data: confirmedRole } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();

    return Boolean(confirmedRole);
  } catch {
    return false;
  }
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
