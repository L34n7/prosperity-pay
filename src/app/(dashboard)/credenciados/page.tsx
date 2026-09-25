import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { PartnerCustomerPortfolio } from "@/components/partner-customer-portfolio";
import { getPartnerCustomerPortfolio } from "@/lib/partners/customer-portfolio";

export const dynamic = "force-dynamic";

export default async function Page() {
  const portfolio = await getPartnerCustomerPortfolio({ partnerType: "accredited" });

  if (!portfolio.partnerTypes.includes("accredited")) {
    redirect("/afiliados");
  }

  return (
    <>
      <PageHeader
        title="Credenciado"
        description="Acompanhe sua carteira de clientes e o resultado das indicações."
      />
      <PartnerCustomerPortfolio
        portfolio={portfolio}
        title="Carteira de clientes"
        description="Visão comercial dos clientes vinculados às suas vendas como credenciado."
        emptyText="Sua carteira será preenchida automaticamente quando clientes comprarem através dos seus links de credenciado."
      />
    </>
  );
}
