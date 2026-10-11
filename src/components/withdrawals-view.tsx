"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { WithdrawalConfirmationModal } from "@/components/withdrawal-confirmation-modal";
import { formatCents, formatDate, requestJson } from "@/lib/operational";
import styles from "./withdrawals-view.module.css";

type Balance = { available_cents: number };
type Pix = {
  id: string;
  key_type: string;
  key_last4: string;
  status: string;
};
type Identity = { status: string };
type Withdrawal = {
  id: string;
  status: string;
  amount_cents: number;
  payout_key_type: string;
  payout_key_last4: string;
  payout_holder_name: string;
  payout_holder_tax_id_last4: string;
  note: string | null;
  receipt_reference: string | null;
  requested_at: string;
  processed_at: string | null;
  paid_at: string | null;
  created_at: string;
};
type PendingWithdrawal = {
  amountCents: number;
  payoutAccountId: string;
  pixLabel: string;
};

const WITHDRAWAL_STATUS: Record<string, { label: string; tone: string }> = {
  requested: { label: "Solicitado", tone: "pending" },
  processing: { label: "Em processamento", tone: "processing" },
  paid: { label: "Pago", tone: "approved" },
  rejected: { label: "Rejeitado", tone: "rejected" },
  failed: { label: "Falhou", tone: "rejected" },
  cancelled: { label: "Cancelado", tone: "rejected" },
};

function withdrawalStatusClass(status: string) {
  const tone = WITHDRAWAL_STATUS[status]?.tone ?? "pending";
  if (tone === "approved") return `${styles.statusBadge} ${styles.statusApproved}`;
  if (tone === "processing") return `${styles.statusBadge} ${styles.statusProcessing}`;
  if (tone === "rejected") return `${styles.statusBadge} ${styles.statusRejected}`;
  return `${styles.statusBadge} ${styles.statusPending}`;
}

export function WithdrawalsView() {
  const [balance, setBalance] = useState<Balance>({ available_cents: 0 });
  const [pix, setPix] = useState<Pix[]>([]);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingWithdrawal | null>(null);

  const verifiedPix = useMemo(
    () => pix.filter((item) => item.status === "verified"),
    [pix],
  );

  const load = useCallback(async () => {
    try {
      const [b, p, i, w] = await Promise.all([
        requestJson<{ balance: Balance }>("/api/balance"),
        requestJson<{ payoutAccounts: Pix[] }>("/api/financial-profile/pix"),
        requestJson<{ verification: Identity | null }>("/api/financial-profile/identity"),
        requestJson<{ withdrawals: Withdrawal[] }>("/api/withdrawals"),
      ]);

      setBalance(b.balance);
      setPix(p.payoutAccounts);
      setIdentity(i.verification);
      setItems(w.withdrawals);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    const data = new FormData(event.currentTarget);
    const amountCents = Math.round(Number(data.get("amount")) * 100);
    const payoutAccountId = String(data.get("pix") ?? "");
    const selectedPix = verifiedPix.find((item) => item.id === payoutAccountId);

    if (!Number.isFinite(amountCents) || amountCents < 500) {
      setError("O saque mínimo é de R$ 5,00.");
      return;
    }
    if (amountCents > balance.available_cents) {
      setError("O valor solicitado é maior que o saldo disponível.");
      return;
    }
    if (!selectedPix) {
      setError("Escolha uma chave Pix verificada.");
      return;
    }

    setPending({
      amountCents,
      payoutAccountId,
      pixLabel: `${selectedPix.key_type.toUpperCase()} · ••••${selectedPix.key_last4}`,
    });
  }

  async function confirmWithdrawal() {
    if (!pending) return;

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson("/api/withdrawals", {
        method: "POST",
        body: JSON.stringify({
          amountCents: pending.amountCents,
          payoutAccountId: pending.payoutAccountId,
        }),
      });

      setPending(null);
      setMessage("Saque solicitado e enviado para análise.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha no saque.");
    } finally {
      setBusy(false);
    }
  }

  const allowed =
    identity?.status === "approved" && verifiedPix.length > 0;

  return (
    <>
      <PageHeader
        title="Saques"
        description="Solicite transferência do saldo disponível por Pix."
      />

      <div className={styles.pageStack}>
        {error && (
          <div className={`${styles.notice} ${styles.error}`} role="alert">
            {error}
          </div>
        )}
        {message && (
          <div className={`${styles.notice} ${styles.success}`} role="status">
            {message}
          </div>
        )}

        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2>Solicitar saque</h2>
              <p>Escolha a chave de destino e informe o valor desejado.</p>
            </div>
            <strong className={styles.balance}>
              {formatCents(balance.available_cents)}
            </strong>
          </header>

          <div className={styles.panelBody}>
            {!allowed ? (
              <p className={styles.blocked}>
                Para sacar, conclua a verificação de identidade e cadastre uma
                chave Pix aprovada. <Link href="/conta">Dados financeiros →</Link>
              </p>
            ) : (
              <form onSubmit={submit} className={styles.form}>
                <label className={styles.field}>
                  <span>Chave Pix</span>
                  <select name="pix" required>
                    {verifiedPix.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.key_type.toUpperCase()} · ••••{item.key_last4}
                      </option>
                    ))}
                  </select>
                  <small>Selecione uma chave Pix verificada.</small>
                </label>

                <label className={styles.field}>
                  <span>Valor (R$)</span>
                  <input
                    name="amount"
                    type="number"
                    min="5"
                    max={balance.available_cents / 100}
                    step="0.01"
                    placeholder="5,00"
                    required
                  />
                  <small>
                    Mínimo R$ 5,00 · Máximo {formatCents(balance.available_cents)}
                  </small>
                </label>

                <div className={styles.actionCell}>
                  <button
                    className={styles.submit}
                    disabled={balance.available_cents < 500}
                  >
                    Solicitar saque
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2>Histórico</h2>
              <p>Acompanhe as solicitações realizadas.</p>
            </div>
          </header>

          <div className={styles.panelBody}>
            {items.length ? (
              <div className={styles.historyCards}>
                {items.map((item) => {
                  const status = WITHDRAWAL_STATUS[item.status] ?? {
                    label: item.status,
                    tone: "pending",
                  };
                  return (
                    <article className={styles.historyCard} key={item.id}>
                      <div className={styles.historyTop}>
                        <div>
                          <span className={styles.historyLabel}>Valor solicitado</span>
                          <strong>{formatCents(item.amount_cents)}</strong>
                        </div>
                        <span className={withdrawalStatusClass(item.status)}>
                          {status.label}
                        </span>
                      </div>

                      <div className={styles.historyDetails}>
                        <div>
                          <span>Destino Pix</span>
                          <strong>
                            {item.payout_key_type.toUpperCase()} · ••••
                            {item.payout_key_last4}
                          </strong>
                        </div>
                        <div>
                          <span>Titular</span>
                          <strong>{item.payout_holder_name}</strong>
                        </div>
                        <div>
                          <span>Solicitado em</span>
                          <strong>{formatDate(item.requested_at ?? item.created_at)}</strong>
                        </div>
                        <div>
                          <span>CPF/CNPJ do titular</span>
                          <strong>•••• {item.payout_holder_tax_id_last4}</strong>
                        </div>
                      </div>

                      {item.note && (
                        <div className={styles.rejectionReason}>
                          <strong>
                            {item.status === "rejected"
                              ? "Motivo da rejeição"
                              : "Observação"}
                          </strong>
                          <p>{item.note}</p>
                        </div>
                      )}

                      {item.receipt_reference && (
                        <div className={styles.receipt}>
                          Comprovante / referência: <strong>{item.receipt_reference}</strong>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className={styles.empty}>Nenhum saque solicitado.</p>
            )}
          </div>
        </section>
      </div>

      <WithdrawalConfirmationModal
        open={Boolean(pending)}
        amountCents={pending?.amountCents ?? 0}
        availableCents={balance.available_cents}
        pixLabel={pending?.pixLabel ?? ""}
        busy={busy}
        onCancel={() => {
          if (!busy) setPending(null);
        }}
        onConfirm={confirmWithdrawal}
      />
    </>
  );
}
