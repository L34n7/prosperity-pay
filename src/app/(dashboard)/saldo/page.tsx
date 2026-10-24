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

const COMMISSION_ADJUSTMENT_SOURCES = new Set([
  "commission_base_correction",
  "manual_date_correction_void",
  "manual_date_correction_post",
]);

type PartnerType = "affiliate" | "accredited" | "coproducer";

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
        .select(
          "id,entry_type,amount_cents,available_at,created_at,order_id,source_type",
        )
        .eq("account_id", account.id)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [], error: null };

  if (error) throw error;

  const rows = entries ?? [];

  const entryPartnerType = (
    entry: (typeof rows)[number],
  ): PartnerType | null => {
    if (entry.entry_type === "accredited_commission") return "accredited";
    if (entry.entry_type === "coproducer_commission") return "coproducer";
    if (entry.entry_type === "affiliate_commission") {
      return incomingPartnerTypesByOrder[entry.order_id ?? ""] === "accredited"
        ? "accredited"
        : "affiliate";
    }

    if (
      entry.entry_type === "adjustment" &&
      COMMISSION_ADJUSTMENT_SOURCES.has(entry.source_type ?? "")
    ) {
      const partnerType =
        incomingPartnerTypesByOrder[entry.order_id ?? ""] ?? null;
      if (
        partnerType === "affiliate" ||
        partnerType === "accredited" ||
        partnerType === "coproducer"
      ) {
        return partnerType;
      }
    }

    return null;
  };

  const partnerCredit = (type: PartnerType) =>
    rows
      .filter((entry) => entryPartnerType(entry) === type)
      .reduce((sum, entry) => sum + Number(entry.amount_cents), 0);

  const creditCards: Array<[string, number]> = [
    [
      "Vendas próprias",
      rows
        .filter((entry) => entry.entry_type === "sale_credit")
        .reduce((sum, entry) => sum + Number(entry.amount_cents), 0),
    ],
  ];

  const affiliateCredit = partnerCredit("affiliate");
  const accreditedCredit = partnerCredit("accredited");
  const coproducerCredit = partnerCredit("coproducer");

  if (partnerRoles.affiliate || affiliateCredit !== 0) {
    creditCards.push(["Afiliado", affiliateCredit]);
  }
  if (partnerRoles.accredited || accreditedCredit !== 0) {
    creditCards.push(["Credenciado", accreditedCredit]);
  }
  if (partnerRoles.coproducer || coproducerCredit !== 0) {
    creditCards.push(["Coprodução", coproducerCredit]);
  }

  const entryLabel = (entry: (typeof rows)[number]) => {
    const partnerType = entryPartnerType(entry);

    if (entry.entry_type === "accredited_commission") {
      return "Comissão de credenciado";
    }
    if (entry.entry_type === "affiliate_commission") {
      return partnerType === "accredited"
        ? "Comissão de credenciado"
        : "Comissão de afiliado";
    }
    if (entry.entry_type === "coproducer_commission") {
      return "Comissão de coprodução";
    }
    if (
      entry.entry_type === "adjustment" &&
      COMMISSION_ADJUSTMENT_SOURCES.has(entry.source_type ?? "")
    ) {
      if (partnerType === "accredited") return "Ajuste de comissão de credenciado";
      if (partnerType === "affiliate") return "Ajuste de comissão de afiliado";
      if (partnerType === "coproducer") return "Ajuste de comissão de coprodução";
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
          <div className="payment-report-table-wrap">
            <table className="payment-report-table balance-movements-table">
              <thead>
                <tr>
                  <th>Origem</th>
                  <th>Valor</th>
                  <th>Data</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <strong>{entryLabel(entry)}</strong>
                    </td>
                    <td className="balance-movement-value">
                      {formatCents(entry.amount_cents)}
                    </td>
                    <td>{formatDate(entry.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Sem movimentações até agora.</p>
        )}
        <Link href="/saques">Solicitar saque →</Link>
      </section>
    </>
  );
}
