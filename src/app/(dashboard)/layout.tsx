import { AppShell } from "@/components/layout/app-shell";
import {
  SUPPORT_MODE_COOKIE,
  isSupportModeValue,
} from "@/lib/auth/support-mode";
import { ensureInitialPlatformAdmin } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const supportMode = isSupportModeValue(
    cookieStore.get(SUPPORT_MODE_COOKIE)?.value,
  );
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await ensureInitialPlatformAdmin(user.id);

  const [
    { data: profile },
    { data: roles },
    { data: accreditedMembership },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
    supabase
      .from("affiliate_memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("partner_type", "accredited")
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
  ]);

  const platformAdmin = Boolean(
    roles?.some((item) => item.role === "admin"),
  );
  const financeAdmin =
    platformAdmin ||
    Boolean(roles?.some((item) => item.role === "finance_operator"));

  return (
    <AppShell
      profile={{
        name: profile?.full_name ?? user.email?.split("@")[0] ?? "Usuário",
        email: user.email ?? "",
        admin: financeAdmin,
        platformAdmin,
        accreditedPartner: Boolean(accreditedMembership),
        supportMode,
      }}
    >
      {children}
    </AppShell>
  );
}
