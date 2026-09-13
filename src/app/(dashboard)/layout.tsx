import { AppShell } from "@/components/layout/app-shell";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);
  return <AppShell profile={{ name: profile?.full_name ?? user.email?.split("@")[0] ?? "Usuário", email: user.email ?? "", admin: Boolean(roles?.some((item) => item.role === "admin" || item.role === "finance_operator")) }}>{children}</AppShell>;
}
