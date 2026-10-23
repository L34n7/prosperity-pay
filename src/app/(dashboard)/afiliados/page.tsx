import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/ui/page-header";
import { AffiliateLinks, AvailablePrograms } from "@/components/affiliate-links";
import { PartnerCustomerPortfolio } from "@/components/partner-customer-portfolio";
import { getPartnerCustomerPortfolio } from "@/lib/partners/customer-portfolio";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { user, supabase } = await requireUser();
  const admin = env.supabaseServiceRoleKey ? createAdminClient() : null;
  const db = admin ?? supabase;

  const [portfolio, membershipsResult, programsResult] = await Promise.all([
    getPartnerCustomerPortfolio({ partnerType: "affiliate" }),
    db
      .from("affiliate_memberships")
      .select(
        "id,code,status,partner_type,affiliate_programs(product_id,mode,active,products(name,affiliate_funnel_base_url,offers(name,checkout_slug,status)))",
      )
      .eq("user_id", user.id),
    admin
      ? admin
          .from("affiliate_programs")
          .select(
            "id,mode,marketplace_description,marketplace_tags,landing_page_url,products(id,name,producer_id)",
          )
          .eq("active", true)
          .eq("marketplace_enabled", true)
          .neq("mode", "invite")
          .limit(100)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (membershipsResult.error) throw membershipsResult.error;
  if (programsResult.error) {
    console.error("Falha ao consultar o catálogo de afiliados", {
      code: programsResult.error.code,
    });
  }

  const allMemberships = membershipsResult.data ?? [];
  const affiliateMemberships = allMemberships.filter(
    (membership) => membership.partner_type === "affiliate",
  );
  const joined = new Set(
    allMemberships
      .map((membership) => membership.affiliate_programs?.product_id)
      .filter(Boolean),
  );
  const available = (programsResult.data ?? []).filter(
    (program) =>
      program.products?.producer_id !== user.id &&
      !joined.has(program.products?.id),
  );

  return (
    <>
      <PageHeader
        title="Minhas afiliações"
        description="Indique ofertas e acompanhe somente suas operações como afiliado."
      />

      <section className="panel operational-panel">
        <h2>Suas afiliações</h2>
        {affiliateMemberships.length ? (
          <AffiliateLinks memberships={affiliateMemberships} />
        ) : (
          <p>Você ainda não participa de programas como afiliado.</p>
        )}
      </section>

      <PartnerCustomerPortfolio
        portfolio={portfolio}
        title="Clientes indicados como afiliado"
        description="Clientes que compraram por links de afiliado, separados da sua operação como credenciado."
        emptyText="Quando uma venda for atribuída a um link de afiliado, o cliente aparecerá aqui."
      />

      <section className="panel operational-panel">
        <h2>Programas disponíveis</h2>
        {admin && !programsResult.error ? (
          available.length ? (
            <AvailablePrograms programs={available} />
          ) : (
            <p>Nenhum programa público disponível no momento.</p>
          )
        ) : (
          <p>O catálogo de programas está indisponível no momento.</p>
        )}
      </section>
    </>
  );
}
