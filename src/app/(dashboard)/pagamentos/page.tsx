import Link from "next/link";
import { PaymentsView } from "@/components/payments-view";
import { SalesCashControlView } from "@/components/sales-cash-control-view";
import { PageHeader } from "@/components/ui/page-header";
import { getFinanceView } from "@/lib/finance-view";
import { getSalesCashControlView } from "@/lib/sales/cash-control-view";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const activeTab = firstParam(params.tab) === "caixa" ? "caixa" : "pagamentos";

  const content =
    activeTab === "caixa"
      ? {
          cash: await getSalesCashControlView({
            preset: firstParam(params.preset),
            startDate: firstParam(params.startDate),
            startTime: firstParam(params.startTime),
            endDate: firstParam(params.endDate),
            endTime: firstParam(params.endTime),
          }),
          finance: null,
        }
      : {
          cash: null,
          finance: await getFinanceView(),
        };

  return (
    <>
      <PageHeader
        title="Vendas"
        description="Acompanhe pagamentos e o caixa da operação em um único lugar."
      />

      <nav className="module-tabs" aria-label="Visões de vendas">
        <Link
          href="/pagamentos"
          className={`module-tab${activeTab === "pagamentos" ? " active" : ""}`}
        >
          Pagamentos
        </Link>
        <Link
          href="/pagamentos?tab=caixa"
          className={`module-tab${activeTab === "caixa" ? " active" : ""}`}
        >
          Controle de caixa
        </Link>
      </nav>

      {content.cash ? (
        <SalesCashControlView view={content.cash} />
      ) : content.finance ? (
        <PaymentsView
          orders={content.finance.orders}
          payments={content.finance.payments}
          outgoingCommissions={content.finance.outgoingCommissions}
          outgoingPartnerTypes={content.finance.outgoingPartnerTypes}
        />
      ) : null}
    </>
  );
}
