import Link from "next/link";
import { PaymentStatusChart } from "@/components/dashboard/payment-status-chart";
import { PaymentVolumeChart } from "@/components/dashboard/payment-volume-chart";
import { PageHeader } from "@/components/ui/page-header";
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

      <section className="panel operational-panel">
        <h2>Pagamentos recentes</h2>
        {data.payments.length ? (
          data.payments.slice(0, 5).map((payment) => {
            const order = orderMap.get(payment.order_id);
            const plan =
              metadataText(payment.raw_provider_data, "plan_label") ??
              order?.offers?.name ??
              "Plano não identificado";
            const customer = order?.customers;

            return (
              <div className="record-row" key={payment.id}>
                <span>
                  <strong>{customer?.name || "Comprador"}</strong>
                  <br />
                  <small>{customer?.email || "E-mail não informado"}</small>
                </span>
                <span>
                  <strong>{plan}</strong>
                  <br />
                  <small>{order?.products?.name ?? "Produto"}</small>
                </span>
                <strong>{formatCents(payment.gross_amount_cents)}</strong>
                <span>
                  {formatDate(
                    payment.paid_at ?? order?.paid_at ?? payment.created_at,
                  )}
                </span>
              </div>
            );
          })
        ) : (
          <p>Nenhum pagamento registrado.</p>
        )}
        <Link href="/pagamentos">Ver pagamentos →</Link>
      </section>
    </>
  );
}
