import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/require-user";
import { AccountingView } from "@/components/accounting/accounting-view";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { supabase, user } = await requireUser();
  const { data: role, error } = await supabase.from("user_roles")
    .select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
  if (error || !role) redirect("/dashboard");
  return <AccountingView />;
}
