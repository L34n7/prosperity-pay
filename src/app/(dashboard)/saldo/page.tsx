import Link from "next/link";
import { requireUser } from "@/lib/auth/require-user";
import { getFinanceView } from "@/lib/finance-view";
import { PageHeader } from "@/components/ui/page-header";
import { formatCents, formatDate } from "@/lib/operational";

export const dynamic = "force-dynamic";

const ENTRY_LABELS: Record<string, string> = {
  sale_credit: "Venda própria",
  coproducer_commission: "Comissão de coprodução",
  withdrawal: "Saque",
  refund: "Reembolso",
  chargeback: "Chargeback",
  gateway_fee: "Taxa do Mercado Pago",
  adjustment: "Ajuste",
};

export default async function Page() {
  const [finance, { supabase, user }] = await Promise.all([
    getFinanceView(),
    requireUser(),
  ]);
  const {
    balance,
    withdrawalSummary,
    incomingPartnerTypesByOrder,
    partnerRoles,
  } = finance;

  const { data: account } = await supabase
    .from("ledger_accounts")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: entries, error } = account
    ? await supabase
        .from("ledger_entries")
        .select("id,entry_type,amount_cents,available_at,created_at,order_id")
        .eq("account_id", account.id)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [], error: null };

  if (error) throw error;

  const rows = entries ?? [];
  const partnerCredit = (type: "affiliate" | "accredited") =>
    rows
      .filter(
        (entry) =>
          type === "accredited"
            ? entry.entry_type === "accredited_commission" ||
              (entry.entry_type === "affiliate_commission" &&
                incomingPartnerTypesByOrder[entry.order_id ?? ""] === "accredited")
            : entry.entry_type === "affiliate_commission" &&
              incomingPartnerTypesByOrder[entry.order_id ?? ""] !== "accredited",
      )
      .reduce((sum, entry) => sum + Number(entry.amount_cents), 0);

  const creditCards: Array<[string, number]> = [
    [
      "Vendas próprias",
      rows
        .filter((entry) => entry.entry_type === "sale_credit")
        .reduce((sum, entry) => sum + Number(entry.amount_cents), 0),
    ],
  ];

  if (partnerRoles.affiliate || partnerCredit("affiliate") > 0) {
    creditCards.push(["Afiliado", partnerCredit("affiliate")]);
  }
  if (partnerRoles.accredited || partnerCredit("accredited") > 0) {
    creditCards.push(["Credenciado", partnerCredit("accredited")]);
  }
  if (partnerRoles.coproducer) {
    creditCards.push([
      "Coprodução",
      rows
        .filter((entry) => entry.entry_type === "coproducer_commission")
        .reduce((sum, entry) => sum + Number(entry.amount_cents), 0),
    ]);
  }

  const entryLabel = (entry: (typeof rows)[number]) => {
    if (entry.entry_type === "accredited_commission") {
      return "Comissão de credenciado";
    }
    if (entry.entry_type === "affiliate_commission") {
      return incomingPartnerTypesByOrder[entry.order_id ?? ""] === "accredited"
        ? "Comissão de credenciado"
        : "Comissão de afiliado";
    }
    return ENTRY_LABELS[entry.entry_type] ?? entry.entry_type;
  };

  return (
    <>
      <PageHeader
        title="Saldo"
        description="Movimentações registradas no seu saldo Prosperity Pay."
      />

      <section className="operational-stats">
        {[
          ["Pendente", balance.pending_cents],
          ["Disponível para saque", withdrawalSummary.withdrawable_cents],
          ["Em saque", balance.withdrawing_cents],
          ["Total creditado", balance.total_received_cents],
        ].map(([label, value]) => (
          <article key={String(label)} className="panel operational-stat">
            <span>{label}</span>
            <strong>{formatCents(Number(value))}</strong>
          </article>
        ))}
      </section>

      {withdrawalSummary.residual_cents > 0 &&
        withdrawalSummary.withdrawable_cents === 0 && (
          <section className="panel balance-residual-note">
            <strong>Saldo residual: {formatCents(withdrawalSummary.residual_cents)}</strong>
            <span>
              O valor permanece na carteira, mas ainda não está disponível para
              saque porque o mínimo é R$ 5,00.
            </span>
          </section>
        )}

      <section className="panel operational-panel">
        <h2>Créditos nas últimas 100 movimentações</h2>
        <div className="operational-stats">
          {creditCards.map(([label, value]) => (
            <article className="panel operational-stat" key={label}>
              <span>{label}</span>
              <strong>{formatCents(value)}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="panel operational-panel">
        <h2>Movimentações</h2>
        {rows.length ? (
          rows.map((entry) => (
            <div className="record-row" key={entry.id}>
              <strong>{entryLabel(entry)}</strong>
              <span>{formatCents(entry.amount_cents)}</span>
              <span>{formatDate(entry.created_at)}</span>
            </div>
          ))
        ) : (
          <p>Sem movimentações até agora.</p>
        )}
        <Link href="/saques">Solicitar saque →</Link>
      </section>
    </>
  );
}
