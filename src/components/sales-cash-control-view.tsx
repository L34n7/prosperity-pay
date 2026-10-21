import Link from "next/link";
import { OperationalStatsGrid } from "@/components/dashboard/operational-stats-grid";
import type { SalesCashControlView as SalesCashControlViewModel } from "@/lib/sales/cash-control-view";
import { formatCents } from "@/lib/operational";

function periodLabel({
  month,
  day,
  hour,
}: SalesCashControlViewModel["filters"]) {
  const [year, monthNumber] = month.split("-").map(Number);
  const reference = new Date(Date.UTC(year, monthNumber - 1, day ?? 1, 12));
  const dateLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    ...(day ? { day: "2-digit" as const } : {}),
    timeZone: "UTC",
  }).format(reference);
  return hour == null
    ? dateLabel
    : `${dateLabel} · ${String(hour).padStart(2, "0")}:00–${String(hour).padStart(2, "0")}:59`;
}

export function SalesCashControlView({
  view,
}: {
  view: SalesCashControlViewModel;
}) {
  const { totals, isPlatformAdmin, filters, daysInMonth } = view;
  const feeValue = isPlatformAdmin
    ? totals.prosperity_fee_cents
    : totals.prosperity_fee_cents + totals.provider_fee_cents;

  const items = [
    ["Vendas", String(Number(totals.sales_count))],
    ["Volume processado", formatCents(Number(totals.volume_cents))],
    ["Receita dos produtos", formatCents(Number(totals.product_revenue_cents))],
    ["Ticket médio", formatCents(Number(totals.ticket_average_cents))],
    [isPlatformAdmin ? "Saldo disponível geral" : "Saldo disponível", formatCents(Number(totals.available_cents))],
    [isPlatformAdmin ? "Saldo em retenção geral" : "Saldo em retenção", formatCents(Number(totals.pending_cents))],
    ["Saques realizados", formatCents(Number(totals.withdrawals_cents))],
    [isPlatformAdmin ? "Taxas Prosperity" : "Taxas (Prosperity + MP)", formatCents(Number(feeValue))],
    [isPlatformAdmin ? "Comissões afiliados" : "Comissões para afiliados", formatCents(Number(totals.affiliate_commission_cents))],
    [isPlatformAdmin ? "Comissões credenciados" : "Comissões para credenciados", formatCents(Number(totals.accredited_commission_cents))],
    [isPlatformAdmin ? "Comissões coprodutores" : "Comissões para coprodutores", formatCents(Number(totals.coproducer_commission_cents))],
    [isPlatformAdmin ? "Comissões totais" : "Total de comissões", formatCents(Number(totals.total_commission_cents))],
  ] as const;

  return (
    <>
      <section className="panel cash-control-panel">
        <div className="cash-control-heading">
          <div>
            <p className="eyebrow">Controle de caixa</p>
            <h2>Total de vendas mensal</h2>
            <span>
              {periodLabel(filters)} · horário de Brasília
            </span>
          </div>

          <form className="cash-control-filters" method="get">
            <input type="hidden" name="tab" value="caixa" />
            <label>
              Mês
              <input type="month" name="month" defaultValue={filters.month} />
            </label>
            <label>
              Dia
              <select name="day" defaultValue={filters.day ?? ""}>
                <option value="">Todos</option>
                {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => (
                  <option key={day} value={day}>
                    {String(day).padStart(2, "0")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Hora
              <select name="hour" defaultValue={filters.hour ?? ""}>
                <option value="">Todas</option>
                {Array.from({ length: 24 }, (_, hour) => (
                  <option key={hour} value={hour}>
                    {String(hour).padStart(2, "0")}:00–{String(hour).padStart(2, "0")}:59
                  </option>
                ))}
              </select>
            </label>
            <div className="cash-control-actions">
              <button className="primary-button" type="submit">Aplicar</button>
              <Link className="secondary-button" href="/pagamentos?tab=caixa">Mês atual</Link>
            </div>
          </form>
        </div>
      </section>

      <OperationalStatsGrid items={items} />
      <p className="cash-control-note">
        Saldo disponível e saldo em retenção mostram a posição atual. Os demais cards respeitam a competência selecionada.
      </p>
    </>
  );
}
