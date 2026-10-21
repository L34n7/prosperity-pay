import { OperationalStatsGrid } from "@/components/dashboard/operational-stats-grid";
import { SalesCashFilters } from "@/components/sales-cash-filters";
import type { SalesCashControlView as SalesCashControlViewModel } from "@/lib/sales/cash-control-view";
import { formatCents } from "@/lib/operational";

function dateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

export function SalesCashControlView({
  view,
}: {
  view: SalesCashControlViewModel;
}) {
  const { totals, isPlatformAdmin, filters } = view;
  const feeValue = isPlatformAdmin
    ? totals.prosperity_fee_cents
    : totals.prosperity_fee_cents + totals.provider_fee_cents;

  const items = [
    ["Vendas", String(Number(totals.sales_count))],
    ["Volume processado", formatCents(Number(totals.volume_cents))],
    ["Receita dos produtos", formatCents(Number(totals.product_revenue_cents))],
    ["Ticket médio", formatCents(Number(totals.ticket_average_cents))],
    [
      isPlatformAdmin ? "Saldo disponível geral" : "Saldo disponível",
      formatCents(Number(totals.available_cents)),
    ],
    [
      isPlatformAdmin ? "Saldo em retenção geral" : "Saldo em retenção",
      formatCents(Number(totals.pending_cents)),
    ],
    ["Saques realizados", formatCents(Number(totals.withdrawals_cents))],
    [
      isPlatformAdmin ? "Taxas Prosperity" : "Taxas (Prosperity + MP)",
      formatCents(Number(feeValue)),
    ],
    [
      isPlatformAdmin ? "Comissões afiliados" : "Comissões para afiliados",
      formatCents(Number(totals.affiliate_commission_cents)),
    ],
    [
      isPlatformAdmin
        ? "Comissões credenciados"
        : "Comissões para credenciados",
      formatCents(Number(totals.accredited_commission_cents)),
    ],
    [
      isPlatformAdmin
        ? "Comissões coprodutores"
        : "Comissões para coprodutores",
      formatCents(Number(totals.coproducer_commission_cents)),
    ],
    [
      isPlatformAdmin ? "Comissões totais" : "Total de comissões",
      formatCents(Number(totals.total_commission_cents)),
    ],
  ] as const;

  return (
    <>
      <section className="panel cash-control-panel">
        <div className="cash-control-heading">
          <div>
            <p className="eyebrow">Controle de caixa</p>
            <h2>Vendas por período</h2>
            <span>Filtros por data e hora no horário de Brasília.</span>
            <div className="cash-control-range-summary">
              {dateLabel(filters.startDate)} {filters.startTime} →{" "}
              {dateLabel(filters.endDate)} {filters.endTime}
            </div>
          </div>

          <SalesCashFilters
            preset={filters.preset}
            fields={{
              startDate: filters.startDate,
              startTime: filters.startTime,
              endDate: filters.endDate,
              endTime: filters.endTime,
            }}
          />
        </div>
      </section>

      <OperationalStatsGrid items={items} />
      <p className="cash-control-note">
        Saldo disponível e saldo em retenção mostram a posição atual. Os demais
        cards respeitam exatamente o período selecionado.
      </p>
    </>
  );
}
