import { AppShell } from "@/components/layout/app-shell";
import { ensureInitialPlatformAdmin } from "@/lib/auth/require-user";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  await ensureInitialPlatformAdmin(user.id);
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);
  const platformAdmin = Boolean(roles?.some((item) => item.role === "admin"));
  const financeAdmin = platformAdmin || Boolean(roles?.some((item) => item.role === "finance_operator"));
  return <AppShell profile={{ name: profile?.full_name ?? user.email?.split("@")[0] ?? "Usuário", email: user.email ?? "", admin: financeAdmin, platformAdmin }}>{children}</AppShell>;
}
