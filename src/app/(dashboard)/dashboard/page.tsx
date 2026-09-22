import Link from "next/link";
import { PaymentStatusChart } from "@/components/dashboard/payment-status-chart";
import { PaymentVolumeChart } from "@/components/dashboard/payment-volume-chart";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import type { PaymentStatus } from "@/lib/payments";
import { getFinanceView } from "@/lib/finance-view";
import { formatCents, formatDate } from "@/lib/operational";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function metadataText(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

export default async function Page() {
  const data = await getFinanceView();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user!.id)
    .maybeSingle();

  const approved = data.payments.filter((payment) => payment.status === "approved");
  const volume = approved.reduce(
    (sum, payment) => sum + Number(payment.gross_amount_cents),
    0,
  );

  const ownRevenue = data.orders
    .filter((order) => approved.some((payment) => payment.order_id === order.id))
    .reduce(
      (sum, order) =>
        sum +
        Number(order.financial_snapshots?.producer_amount_cents ?? 0) -
        (order.settlement_model === "prosperity_balance"
          ? Number(
              approved.find((payment) => payment.order_id === order.id)
                ?.provider_fee_amount_cents ?? 0,
            )
          : 0),
      0,
    );

  const affiliate = data.commissions
    .filter((commission) => commission.commission_type === "affiliate")
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);

  const coproducer = data.commissions
    .filter((commission) => commission.commission_type === "coproducer")
    .reduce((sum, commission) => sum + Number(commission.amount_cents), 0);

  const orderMap = new Map(data.orders.map((order) => [order.id, order]));

  return (
    <>
      <PageHeader
        eyebrow={
          "Olá, " +
          (profile?.full_name?.split(" ")[0] ??
            user?.email?.split("@")[0] ??
            "usuário")
        }
        title="Dashboard financeiro"
        description="Acompanhe seus resultados confirmados."
      />

      <section className="operational-stats">
        {[
          ["Vendas", String(approved.length)],
          ["Volume processado", formatCents(volume)],
          ["Receita dos produtos", formatCents(ownRevenue)],
          ["Comissões de afiliado", formatCents(affiliate)],
          ["Coprodução", formatCents(coproducer)],
          ["Saldo pendente", formatCents(data.balance.pending_cents)],
          ["Saldo disponível", formatCents(data.balance.available_cents)],
          [
            "Saques",
            formatCents(
              data.withdrawals.reduce(
                (sum, withdrawal) => sum + Number(withdrawal.amount_cents),
                0,
              ),
            ),
          ],
        ].map(([label, value]) => (
          <article className="panel operational-stat" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      {!data.orders.length && (
        <section className="panel operational-panel">
          <h2>Comece a vender</h2>
          <p>
            Sua conta começa zerada. Configure seu primeiro produto e seus dados
            financeiros.
          </p>
          <div className="button-row">
            <Link href="/produtos" className="primary-button">
              Criar produto
            </Link>
            <Link href="/integracoes" className="secondary-button">
              Conectar Mercado Pago
            </Link>
            <Link href="/conta" className="secondary-button">
              Dados financeiros
            </Link>
          </div>
        </section>
      )}

      <div className="finance-charts">
        <PaymentVolumeChart payments={data.payments} />
        <PaymentStatusChart payments={data.payments} />
      </div>

      <section className="panel payment-report-panel">
        <div className="premium-report-head">
          <div>
            <p className="eyebrow">Movimentações</p>
            <h2>Pagamentos recentes</h2>
            <span>Últimas transações registradas nos seus produtos.</span>
          </div>
          <Link href="/pagamentos" className="text-link">
            Ver todos →
          </Link>
        </div>

        {data.payments.length ? (
          <div className="payment-report-table-wrap">
            <table className="payment-report-table payment-report-table-dashboard">
              <thead>
                <tr>
                  <th>Comprador</th>
                  <th>Plano / produto</th>
                  <th>Status</th>
                  <th>Valor</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {data.payments.slice(0, 5).map((payment) => {
                  const order = orderMap.get(payment.order_id);
                  const plan =
                    metadataText(payment.raw_provider_data, "plan_label") ??
                    order?.offers?.name ??
                    "Plano não identificado";
                  const customer = order?.customers;

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
                        <StatusBadge status={payment.status as PaymentStatus} />
                      </td>
                      <td className="payment-value">
                        {formatCents(payment.gross_amount_cents)}
                      </td>
                      <td className="payment-date">
                        {formatDate(
                          payment.paid_at ?? order?.paid_at ?? payment.created_at,
                        )}
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
    </>
  );
}
