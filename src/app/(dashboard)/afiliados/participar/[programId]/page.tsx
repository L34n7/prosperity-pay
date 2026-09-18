import { notFound, redirect } from "next/navigation";
import { AffiliateProgramJoin } from "@/components/affiliate-program-join";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const next = `/afiliados/participar/${programId}`;
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);

  const admin = createAdminClient();
  const { data: program } = await admin.from("affiliate_programs")
    .select("id,mode,active,terms,support_email,landing_page_url,products(name,producer_id)")
    .eq("id", programId)
    .maybeSingle();

  if (!program?.active || program.mode === "invite" || !program.products || Array.isArray(program.products)) notFound();
  if (program.products.producer_id === user.id) redirect("/afiliados");

  return <AffiliateProgramJoin
    programId={program.id}
    productName={program.products.name}
    mode={program.mode}
    terms={program.terms}
    supportEmail={program.support_email}
    landingPageUrl={program.landing_page_url}
  />;
}
