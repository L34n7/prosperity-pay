import { redirect } from "next/navigation";
import { UsersSupportView } from "@/components/users-support-view";
import { requirePlatformAdmin } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requirePlatformAdmin();
  const admin = createAdminClient();

  const [{ data: profiles, error: profilesError }, { data: roles, error: rolesError }] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id,full_name,email,created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      admin
        .from("user_roles")
        .select("user_id,role"),
    ]);

  if (profilesError || rolesError) {
    console.error("[ADMIN_USERS] Falha ao carregar usuários.", {
      profilesError,
      rolesError,
    });
    redirect("/admin");
  }

  const rolesByUser = new Map<string, string[]>();
  for (const item of roles ?? []) {
    const current = rolesByUser.get(item.user_id) ?? [];
    current.push(item.role);
    rolesByUser.set(item.user_id, current);
  }

  return (
    <UsersSupportView
      users={(profiles ?? []).map((profile) => ({
        id: profile.id,
        fullName: profile.full_name,
        email: profile.email,
        createdAt: profile.created_at,
        roles: rolesByUser.get(profile.id) ?? [],
      }))}
    />
  );
}
