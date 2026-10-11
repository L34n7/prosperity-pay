"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { WithdrawalConfirmationModal } from "@/components/withdrawal-confirmation-modal";
import { formatCents, formatDate, requestJson } from "@/lib/operational";

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
  created_at: string;
};
type PendingWithdrawal = {
  amountCents: number;
  payoutAccountId: string;
  pixLabel: string;
};

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

      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="form-success" role="status">{message}</p>}

      <section className="panel operational-panel">
        <h2>Disponível: {formatCents(balance.available_cents)}</h2>

        {!allowed ? (
          <p>
            Para sacar, conclua a verificação de identidade e cadastre uma chave
            Pix aprovada. <Link href="/conta">Dados financeiros →</Link>
          </p>
        ) : (
          <form onSubmit={submit} className="operational-form form-grid">
            <label>
              Chave Pix
              <select name="pix" required>
                {verifiedPix.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.key_type.toUpperCase()} · ••••{item.key_last4}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Valor (R$)
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

            <button
              className="primary-button"
              disabled={balance.available_cents < 500}
            >
              Solicitar saque
            </button>
          </form>
        )}
      </section>

      <section className="panel operational-panel">
        <h2>Histórico</h2>
        {items.length ? (
          items.map((item) => (
            <div className="record-row" key={item.id}>
              <strong>{formatCents(item.amount_cents)}</strong>
              <span>{item.status}</span>
              <span>{formatDate(item.created_at)}</span>
            </div>
          ))
        ) : (
          <p>Nenhum saque solicitado.</p>
        )}
      </section>

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
