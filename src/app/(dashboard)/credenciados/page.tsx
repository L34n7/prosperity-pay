import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { AffiliateLinks } from "@/components/affiliate-links";
import { PartnerCustomerPortfolio } from "@/components/partner-customer-portfolio";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPartnerCustomerPortfolio } from "@/lib/partners/customer-portfolio";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { user } = await requireUser();
  const admin = createAdminClient();

  const [portfolio, membershipsResult] = await Promise.all([
    getPartnerCustomerPortfolio({ partnerType: "accredited" }),
    admin
      .from("affiliate_memberships")
      .select(
        "id,code,status,partner_type,affiliate_programs(product_id,mode,active,products(name,affiliate_funnel_base_url,offers(name,checkout_slug,status)))",
      )
      .eq("user_id", user.id)
      .eq("partner_type", "accredited")
      .order("created_at", { ascending: false }),
  ]);

  if (membershipsResult.error) throw membershipsResult.error;

  if (!portfolio.partnerTypes.includes("accredited")) {
    redirect("/afiliados");
  }

  return (
    <>
      <PageHeader
        title="Credenciado"
        description="Acompanhe seus links, sua carteira de clientes e o resultado das indicações."
      />

      <section className="panel operational-panel partner-credential-links">
        <h2>Seus links de credenciado</h2>
        <p>
          Use estes links para novas indicações. As vendas e renovações ficam
          vinculadas ao seu credenciamento.
        </p>
        {membershipsResult.data?.length ? (
          <AffiliateLinks memberships={membershipsResult.data} />
        ) : (
          <p>Nenhum credenciamento ativo encontrado.</p>
        )}
      </section>

      <PartnerCustomerPortfolio
        portfolio={portfolio}
        title="Carteira de clientes"
        description="Visão comercial dos clientes vinculados às suas vendas como credenciado."
        emptyText="Sua carteira será preenchida automaticamente quando clientes comprarem através dos seus links de credenciado."
        emphasized
      />
    </>
  );
}
