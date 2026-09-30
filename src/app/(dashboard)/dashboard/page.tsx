import Link from "next/link";
import { DashboardModeSelect } from "@/components/dashboard/dashboard-mode-select";
import { PaymentStatusChart } from "@/components/dashboard/payment-status-chart";
import { PaymentVolumeChart } from "@/components/dashboard/payment-volume-chart";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { ensureInitialPlatformAdmin, requireUser } from "@/lib/auth/require-user";
import { getAdminDashboardView } from "@/lib/dashboard/admin-dashboard-view";
import type { PaymentStatus } from "@/lib/payments";
import { mercadoPagoPaymentMetadata } from "@/lib/payments/mercado-pago-payment-metadata";
import { getFinanceView } from "@/lib/finance-view";
import { formatCents, formatDate } from "@/lib/operational";

export const dynamic = "force-dynamic";

type FinanceView = Awaited<ReturnType<typeof getFinanceView>>;
type DashboardPayment = FinanceView["payments"][number];
type DashboardOrder = FinanceView["orders"][number];

function metadataText(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}

function paymentMethodOf(rawProviderData: unknown) {
  const method = mercadoPagoPaymentMetadata(rawProviderData).method;
  return method === "pix" ? "PIX" : method === "card" ? "Cartão" : "—";
}

function StatsGrid({ items }: { items: Array<[string, string]> }) {
  return (
    <section className="operational-stats">
      {items.map(([label, value]) => (
        <article className="panel operational-stat" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}

function PaymentsReport({
  payments,
  orders,
  description = "Últimas transações registradas nos seus produtos.",
}: {
  payments: DashboardPayment[];
  orders: DashboardOrder[];
  description?: string;
}) {
  const orderMap = new Map(orders.map((order) => [order.id, order]));
  const recentPayments = [...payments]
    .sort((a, b) => {
      const aDate = a.created_at ?? orderMap.get(a.order_id)?.created_at ?? "";
      const bDate = b.created_at ?? orderMap.get(b.order_id)?.created_at ?? "";
      return new Date(bDate).getTime() - new Date(aDate).getTime();
    })
    .slice(0, 5);

  return (
    <section className="panel payment-report-panel">
      <div className="premium-report-head">
        <div>
          <p className="eyebrow">Movimentações</p>
          <h2>Pagamentos recentes</h2>
          <span>{description}</span>
        </div>
        <Link href="/pagamentos" className="text-link">
          Ver todos →
        </Link>
      </div>

      {recentPayments.length ? (
        <div className="payment-report-table-wrap">
          <table className="payment-report-table payment-report-table-dashboard">
            <thead>
              <tr>
                <th>Comprador</th>
                <th>Plano / produto</th>
                <th>Método</th>
                <th>Status</th>
                <th>Valor</th>
                <th>Data</th>
                <th>Data pagamento</th>
              </tr>
            </thead>
            <tbody>
              {recentPayments.map((payment) => {
                const order = orderMap.get(payment.order_id);
                const plan =
                  metadataText(payment.raw_provider_data, "plan_label") ??
                  order?.offers?.name ??
                  "Plano não identificado";
                const customer = order?.customers;
                const method = paymentMethodOf(payment.raw_provider_data);
                const generatedAt =
                  payment.created_at ?? order?.created_at ?? null;
                const paidAt = payment.paid_at ?? order?.paid_at ?? null;

                return (
                  <tr key={payment.id}>
                    <td>
                      <strong>{customer?.name || "Comprador"}</strong>
                      <span>{customer?.email || "E-mail não informado"}</span>
                    </td>
                    <td>
                      <strong>{plan}</strong>
                      <span>{order?.products?.name ?? "Produto"}</span>
                    </td>
                    <td>
                      <span
                        className={
                          "payment-method-pill " +
                          (method === "PIX"
                            ? "is-pix"
                            : method === "Cartão"
                              ? "is-card"
                              : "")
                        }
                      >
                        {method}
                      </span>
                    </td>
                    <td>
                      <StatusBadge status={payment.status as PaymentStatus} />
                    </td>
                    <td className="payment-value">
                      {formatCents(payment.gross_amount_cents)}
                    </td>
                    <td className="payment-date">
                      {generatedAt ? formatDate(generatedAt) : "—"}
                    </td>
                    <td className="payment-date">
                      {paidAt ? formatDate(paidAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="premium-report-empty">Nenhum pagamento registrado.</div>
      )}
    </section>
  );
}

function ProducerDashboard({
  data,
  firstName,
  mode,
}: {
  data: FinanceView;
  firstName: string;
  mode: "producer" | "partner";
}) {
  const approved = data.payments.filter(
    (payment) => payment.status === "approved",
  );
  const approvedOrderIds = new Set(
    approved.map((payment) => payment.order_id),
  );
  const volume = approved.reduce(
    (sum, payment) => sum + Number(payment.gross_amount_cents),
    0,
  );
  const ticketAverage = approved.length
    ? Math.round(volume / approved.length)
    : 0;

  const ownRevenue = data.orders
    .filter((order) => approvedOrderIds.has(order.id))
    .reduce((sum, order) => {
      if (
        order.settlement_model === "prosperity_balance" &&
        order.producer_net_cents !== null
      ) {
        return sum + Number(order.producer_net_cents);
      }
      return (
        sum +
        Number(order.financial_snapshots?.producer_amount_cents ?? 0) -
        (order.settlement_model === "prosperity_balance"
          ? Number(
              approved.find((payment) => payment.order_id === order.id)
                ?.provider_fee_amount_cents ?? 0,
            )
          : 0)
      );
    }, 0);

  const paymentOrderById = new Map(
    data.payments.map((payment) => [payment.id, payment.order_id]),
  );
  const validOutgoing = data.outgoingCommissions.filter(
    (commission) =>
      commission.status !== "cancelled" && commission.status !== "reversed",
  );
  const affiliate = validOutgoing
    .filter((commission) => {
      if (commission.commission_type !== "affiliate") return false;
      const orderId = paymentOrderById.get(commission.payment_id);
      return (
        !orderId || data.outgoingPartnerTypes[orderId] !== "accredited"
      );
    })
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);
  const accredited = validOutgoing
    .filter((commission) => {
      if (commission.commission_type !== "affiliate") return false;
      const orderId = paymentOrderById.get(commission.payment_id);
      return Boolean(
        orderId && data.outgoingPartnerTypes[orderId] === "accredited",
      );
    })
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);
  const coproducer = validOutgoing
    .filter((commission) => commission.commission_type === "coproducer")
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);
  const totalCommissions = affiliate + accredited + coproducer;

  const withdrawalsTotal = data.withdrawals
    .filter((withdrawal) => withdrawal.status === "paid")
    .reduce(
      (sum, withdrawal) => sum + Number(withdrawal.amount_cents),
      0,
    );
  const totalFees = data.orders
    .filter((order) => approvedOrderIds.has(order.id))
    .reduce((sum, order) => {
      const payment = approved.find((item) => item.order_id === order.id);
      return (
        sum +
        Number(
          order.financial_snapshots?.prosperity_fee_amount_cents ?? 0,
        ) +
        Number(payment?.provider_fee_amount_cents ?? 0)
      );
    }, 0);

  return (
    <>
      <PageHeader
        eyebrow={"Olá, " + firstName}
        title="Dashboard financeiro"
        description="Acompanhe os resultados dos seus produtos."
        action={
          <DashboardModeSelect
            mode={mode}
            hasProducer={data.hasProducts}
            hasPartner={data.hasPartner}
          />
        }
      />

      <StatsGrid
        items={[
          ["Vendas", String(approved.length)],
          ["Volume processado", formatCents(volume)],
          ["Receita dos produtos", formatCents(ownRevenue)],
          ["Ticket médio", formatCents(ticketAverage)],
          ["Saldo disponível", formatCents(data.balance.available_cents)],
          ["Saldo em retenção", formatCents(data.balance.pending_cents)],
          ["Saques realizados", formatCents(withdrawalsTotal)],
          ["Taxas (Prosperity + MP)", formatCents(totalFees)],
          ["Comissões para afiliados", formatCents(affiliate)],
          ["Comissões para credenciados", formatCents(accredited)],
          ["Comissões para coprodutores", formatCents(coproducer)],
          ["Comissões totais", formatCents(totalCommissions)],
        ]}
      />

      {!data.orders.length && (
        <section className="panel operational-panel">
          <h2>Comece a vender</h2>
          <p>
            Configure seu primeiro produto e seus dados financeiros para
            acompanhar os resultados por aqui.
          </p>
          <div className="button-row">
            <Link href="/produtos" className="primary-button">
              Criar produto
            </Link>
            <Link href="/integracoes" className="secondary-button">
              Conectar Mercado Pago
            </Link>
          </div>
        </section>
      )}

      <div className="finance-charts">
        <PaymentVolumeChart payments={data.payments} />
        <PaymentStatusChart payments={data.payments} />
      </div>

      <PaymentsReport payments={data.payments} orders={data.orders} />
    </>
  );
}

function PartnerDashboard({
  data,
  firstName,
  mode,
}: {
  data: FinanceView;
  firstName: string;
  mode: "producer" | "partner";
}) {
  const now = Date.now();
  const valid = data.commissions.filter(
    (commission) =>
      commission.status !== "cancelled" && commission.status !== "reversed",
  );

  const effectiveStatus = (commission: FinanceView["commissions"][number]) =>
    commission.status === "pending" &&
    new Date(commission.available_at).getTime() <= now
      ? "available"
      : commission.status;

  const generated = valid.reduce(
    (sum, commission) => sum + Number(commission.amount_cents),
    0,
  );
  const retained = valid
    .filter((commission) => effectiveStatus(commission) === "pending")
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);
  const available = valid
    .filter((commission) => effectiveStatus(commission) === "available")
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);
  const received = valid
    .filter((commission) => effectiveStatus(commission) === "paid")
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);

  const partnerTypeByProduct = new Map<string, string>();
  for (const membership of data.partnerMemberships) {
    const program = data.partnerPrograms.find(
      (item) => item.id === membership.program_id,
    );
    if (program) {
      partnerTypeByProduct.set(program.product_id, membership.partner_type);
    }
  }

  const affiliate = valid
    .filter(
      (commission) =>
        commission.commission_type === "affiliate" &&
        partnerTypeByProduct.get(
          commission.payments?.orders?.product_id ?? "",
        ) !== "accredited",
    )
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);
  const accredited = valid
    .filter(
      (commission) =>
        commission.commission_type === "affiliate" &&
        partnerTypeByProduct.get(
          commission.payments?.orders?.product_id ?? "",
        ) === "accredited",
    )
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);
  const coproducer = valid
    .filter((commission) => commission.commission_type === "coproducer")
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);

  const roleCards: Array<[string, string]> = [];
  if (data.partnerRoles.affiliate || affiliate > 0)
    roleCards.push(["Como afiliado", formatCents(affiliate)]);
  if (data.partnerRoles.accredited || accredited > 0)
    roleCards.push(["Como credenciado", formatCents(accredited)]);
  if (data.partnerRoles.coproducer || coproducer > 0)
    roleCards.push(["Como coprodutor", formatCents(coproducer)]);

  return (
    <>
      <PageHeader
        eyebrow={"Olá, " + firstName}
        title="Dashboard financeiro"
        description="Acompanhe as comissões que você recebe como parceiro."
        action={
          <DashboardModeSelect
            mode={mode}
            hasProducer={data.hasProducts}
            hasPartner={data.hasPartner}
          />
        }
      />

      <StatsGrid
        items={[
          ["Comissões geradas", formatCents(generated)],
          ["Em retenção", formatCents(retained)],
          ["Disponível", formatCents(available)],
          ["Já recebido", formatCents(received)],
        ]}
      />

      {roleCards.length > 0 && (
        <section className="operational-stats partner-role-stats">
          {roleCards.map(([label, value]) => (
            <article className="panel operational-stat" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </section>
      )}

      <section className="panel operational-panel">
        <h2>Comissões recentes</h2>
        {valid.length ? (
          valid.slice(0, 8).map((commission) => (
            <div className="record-row" key={commission.id}>
              <strong>
                {commission.commission_type === "coproducer"
                  ? "Coprodutor"
                  : partnerTypeByProduct.get(
                        commission.payments?.orders?.product_id ?? "",
                      ) === "accredited"
                    ? "Credenciado"
                    : "Afiliado"}
                {" · "}
                {commission.payments?.orders?.products?.name ?? "Produto"}
              </strong>
              <span>{formatCents(commission.amount_cents)}</span>
              <span>
                {effectiveStatus(commission) === "pending"
                  ? "Em retenção"
                  : effectiveStatus(commission) === "available"
                    ? "Disponível"
                    : "Pago"}
              </span>
            </div>
          ))
        ) : (
          <p>Nenhuma comissão registrada até o momento.</p>
        )}
      </section>
    </>
  );
}

async function AdminDashboard({ firstName }: { firstName: string }) {
  const data = await getAdminDashboardView();
  const totals = data.totals;

  return (
    <>
      <PageHeader
        eyebrow={"Olá, " + firstName}
        title="Dashboard administrativo"
        description="Visão consolidada de toda a operação da Prosperity Pay."
      />

      <StatsGrid
        items={[
          ["Vendas", String(Number(totals.sales_count))],
          ["Volume processado", formatCents(Number(totals.volume_cents))],
          [
            "Receita dos produtos",
            formatCents(Number(totals.product_revenue_cents)),
          ],
          [
            "Ticket médio",
            formatCents(Number(totals.ticket_average_cents)),
          ],
          [
            "Saldo disponível geral",
            formatCents(Number(totals.available_cents)),
          ],
          [
            "Saldo em retenção geral",
            formatCents(Number(totals.pending_cents)),
          ],
          [
            "Saques realizados",
            formatCents(Number(totals.withdrawals_cents)),
          ],
          [
            "Taxas Prosperity",
            formatCents(Number(totals.prosperity_fee_cents)),
          ],
          [
            "Comissões de afiliados",
            formatCents(Number(totals.affiliate_commission_cents)),
          ],
          [
            "Comissões de credenciados",
            formatCents(Number(totals.accredited_commission_cents)),
          ],
          [
            "Comissões de coprodutores",
            formatCents(Number(totals.coproducer_commission_cents)),
          ],
          [
            "Comissões totais",
            formatCents(Number(totals.total_commission_cents)),
          ],
        ]}
      />

      <div className="finance-charts">
        <PaymentVolumeChart payments={data.payments} />
        <PaymentStatusChart payments={data.payments} />
      </div>

      <PaymentsReport
        payments={data.payments}
        orders={data.orders}
        description="Últimas transações registradas em toda a plataforma."
      />
    </>
  );
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { user, supabase } = await requireUser();
  const [authorizedAdmin, profileResult, params] = await Promise.all([
    ensureInitialPlatformAdmin(user.id),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", user.id)
      .maybeSingle(),
    searchParams,
  ]);

  const firstName =
    profileResult.data?.full_name?.split(" ")[0] ??
    user.email?.split("@")[0] ??
    "usuário";

  if (authorizedAdmin) {
    return <AdminDashboard firstName={firstName} />;
  }

  const data = await getFinanceView();
  const requested = params.view;
  const defaultMode: "producer" | "partner" = data.hasProducts
    ? "producer"
    : data.hasPartner
      ? "partner"
      : "producer";
  const mode: "producer" | "partner" =
    requested === "partner" && data.hasPartner
      ? "partner"
      : requested === "producer" && data.hasProducts
        ? "producer"
        : defaultMode;

  if (mode === "partner") {
    return (
      <PartnerDashboard data={data} firstName={firstName} mode={mode} />
    );
  }

  return <ProducerDashboard data={data} firstName={firstName} mode={mode} />;
}
