"use client";

import { Banknote, ShieldCheck, X } from "lucide-react";
import { formatCents } from "@/lib/operational";
import styles from "./withdrawal-confirmation-modal.module.css";

export function WithdrawalConfirmationModal({
  open,
  amountCents,
  availableCents,
  pixLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  amountCents: number;
  availableCents: number;
  pixLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <section
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="withdrawal-confirm-title"
      >
        <header className={styles.header}>
          <div className={styles.titleWrap}>
            <span className={styles.icon}>
              <Banknote size={22} />
            </span>
            <div>
              <small>Confirmação de saque</small>
              <h2 id="withdrawal-confirm-title">Revisar solicitação</h2>
            </div>
          </div>

          <button
            type="button"
            className={styles.close}
            onClick={onCancel}
            disabled={busy}
            aria-label="Fechar"
          >
            <X size={19} />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.amountCard}>
            <span>Valor solicitado</span>
            <strong>{formatCents(amountCents)}</strong>
            <small>
              Saldo após a solicitação:{" "}
              {formatCents(Math.max(0, availableCents - amountCents))}
            </small>
          </div>

          <div className={styles.details}>
            <div>
              <span>Receber em</span>
              <strong>{pixLabel}</strong>
            </div>
            <div>
              <span>Saldo disponível</span>
              <strong>{formatCents(availableCents)}</strong>
            </div>
          </div>

          <div className={styles.info}>
            <ShieldCheck size={18} />
            <p>
              A solicitação ficará em análise administrativa. O valor será reservado
              do saldo disponível até o saque ser processado ou recusado.
            </p>
          </div>

          <p className={styles.limit}>
            Limite por solicitação: mínimo de <strong>R$ 5,00</strong> e máximo
            igual ao saldo disponível.
          </p>
        </div>

        <footer className={styles.footer}>
          <button
            type="button"
            className={styles.cancel}
            onClick={onCancel}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={styles.confirm}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Solicitando..." : "Confirmar saque"}
          </button>
        </footer>
      </section>
    </div>
  );
}
