import { redirect } from "next/navigation";
import { AffiliateInvitationResponse } from "@/components/affiliate-invitation-response";
import { createClient } from "@/lib/supabase/server";

export default async function Page({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  const { data: { user } } = await (await createClient()).auth.getUser();
  const next = `/convites/afiliacao?code=${encodeURIComponent(code ?? "")}`;
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return <AffiliateInvitationResponse code={code ?? ""}/>;
}
