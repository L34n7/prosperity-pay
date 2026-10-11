"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  ExternalLink,
  FileCheck2,
  Fingerprint,
  Landmark,
  RotateCcw,
  UserRound,
  WalletCards,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { formatCents, formatDate, requestJson } from "@/lib/operational";
import styles from "./admin-view.module.css";

type Row = {
  id: string;
  status?: string;
  created_at?: string;
  submitted_at?: string;
  connected_at?: string;
  updated_at?: string;
  amount_cents?: number;
  gross_amount_cents?: number;
  legal_name?: string;
  holder_name?: string;
  full_name?: string;
  user_full_name?: string | null;
  email?: string | null;
  external_account_id?: string;
  action?: string;
  person_type?: string;
  tax_id_last4?: string;
  birth_date?: string | null;
  business_name?: string | null;
  review_note?: string | null;
  document_original_name?: string | null;
  document_url?: string | null;
  key_type?: string;
  key_last4?: string;
  key_value?: string | null;
  holder_tax_id_last4?: string;
  is_primary?: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  under_review: "Em análise",
  approved: "Aprovada",
  rejected: "Rejeitada",
  resubmission_required: "Reenvio necessário",
  pending: "Em análise",
  verified: "Verificada",
  requested: "Solicitado",
  processing: "Processando",
  paid: "Pago",
  failed: "Falhou",
  cancelled: "Cancelado",
};

const PIX_TYPE_LABELS: Record<string, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random_key: "Chave aleatória",
};

function badgeClass(status?: string) {
  if (["approved", "verified", "paid"].includes(status ?? "")) {
    return `${styles.statusBadge} ${styles.approved}`;
  }
  if (["rejected", "failed", "cancelled", "resubmission_required"].includes(status ?? "")) {
    return `${styles.statusBadge} ${styles.rejected}`;
  }
  if (status === "processing") {
    return `${styles.statusBadge} ${styles.processing}`;
  }
  return `${styles.statusBadge} ${styles.pending}`;
}

export function AdminView({
  identity,
  pix,
  withdrawals,
  payments,
  webhooks,
  connections,
  users,
  audit,
}: {
  identity: Row[];
  pix: Row[];
  withdrawals: Row[];
  payments: Row[];
  webhooks: Row[];
  connections: Row[];
  users: Row[];
  audit: Row[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState("Identidade");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const groups: Record<string, Row[]> = {
    Identidade: identity,
    "Chaves Pix": pix,
    Saques: withdrawals,
    Pagamentos: payments,
    Webhooks: webhooks,
    Conexões: connections,
    Usuários: users,
    Auditoria: audit,
  };

  async function act(path: string, status: string, identityReview = false) {
    if (!confirm(`Confirmar a alteração para ${STATUS_LABELS[status] ?? status}?`)) {
      return;
    }

    const reference =
      status === "paid"
        ? prompt("Informe o identificador do comprovante do Pix:")
        : undefined;

    let reviewNote: string | undefined;
    if (identityReview) {
      reviewNote =
        prompt(
          status === "approved"
            ? "Informe uma referência/observação da conferência do documento:"
            : "Informe o motivo ou orientação para o usuário:",
        ) ?? undefined;
    }

    if (status === "paid" && !reference) return;
    if (identityReview && !reviewNote?.trim()) return;

    setBusy(true);
    setError("");

    try {
      await requestJson(path, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          receiptReference: reference,
          reviewNote,
        }),
      });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao atualizar.");
    } finally {
      setBusy(false);
    }
  }

  const currentItems = groups[tab] ?? [];

  return (
    <>
      <PageHeader
        title="Admin Prosperity"
        description="Revisão financeira e operações da plataforma."
      />

      <div className={styles.pageStack}>
        <nav className={styles.tabs}>
          {Object.entries(groups).map(([name, items]) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`${styles.tab} ${tab === name ? styles.tabActive : ""}`}
            >
              {name}
              <span className={styles.count}>{items.length}</span>
            </button>
          ))}
        </nav>

        {error && (
          <div className={styles.error} role="alert">
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <div>
              <h2>{tab}</h2>
              <p>
                {tab === "Identidade"
                  ? "Confira os dados e o documento antes de liberar a identidade."
                  : tab === "Chaves Pix"
                    ? "Confira a chave, o tipo e o titular antes de liberar para saques."
                    : "Acompanhe e processe os registros desta área administrativa."}
              </p>
            </div>
            <span className={styles.count}>{currentItems.length}</span>
          </header>

          <div className={styles.content}>
            {tab === "Identidade" ? (
              identity.length ? (
                <div className={styles.cards}>
                  {identity.map((row) => (
                    <article className={styles.reviewCard} key={row.id}>
                      <div className={styles.reviewTop}>
                        <div className={styles.person}>
                          <span className={styles.avatar}>
                            <Fingerprint size={18} />
                          </span>
                          <div className={styles.personText}>
                            <strong>
                              {row.legal_name ?? row.user_full_name ?? "Usuário"}
                            </strong>
                            <span>{row.email ?? "E-mail não encontrado"}</span>
                          </div>
                        </div>
                        <span className={badgeClass(row.status)}>
                          {STATUS_LABELS[row.status ?? ""] ?? row.status ?? "—"}
                        </span>
                      </div>

                      <div className={styles.details}>
                        <div className={styles.detail}>
                          <span>Tipo de pessoa</span>
                          <strong>
                            {row.person_type === "business"
                              ? "Pessoa jurídica"
                              : "Pessoa física"}
                          </strong>
                        </div>
                        <div className={styles.detail}>
                          <span>{row.person_type === "business" ? "CNPJ" : "CPF"}</span>
                          <strong>•••• {row.tax_id_last4 ?? "—"}</strong>
                        </div>
                        <div className={styles.detail}>
                          <span>
                            {row.person_type === "business"
                              ? "Razão social"
                              : "Nascimento"}
                          </span>
                          <strong>
                            {row.person_type === "business"
                              ? row.business_name || "—"
                              : formatDate(row.birth_date)}
                          </strong>
                        </div>
                        <div className={styles.detail}>
                          <span>Enviado em</span>
                          <strong>{formatDate(row.submitted_at)}</strong>
                        </div>
                        <div className={styles.detail}>
                          <span>Documento</span>
                          <strong>{row.document_original_name || "Documento legado"}</strong>
                        </div>
                      </div>

                      {row.review_note && (
                        <div className={styles.note}>
                          <strong>Observação da última análise:</strong> {row.review_note}
                        </div>
                      )}

                      <div className={styles.actions}>
                        {row.document_url ? (
                          <a
                            className={styles.action}
                            href={row.document_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink size={14} />
                            Ver documento
                          </a>
                        ) : (
                          <span className={styles.action}>Sem documento anexado</span>
                        )}

                        {row.status === "under_review" && (
                          <>
                            <button
                              disabled={busy}
                              className={styles.approveAction}
                              onClick={() =>
                                act(
                                  `/api/admin/identity-verifications/${row.id}`,
                                  "approved",
                                  true,
                                )
                              }
                            >
                              <FileCheck2 size={14} />
                              Aprovar
                            </button>
                            <button
                              disabled={busy}
                              className={styles.action}
                              onClick={() =>
                                act(
                                  `/api/admin/identity-verifications/${row.id}`,
                                  "resubmission_required",
                                  true,
                                )
                              }
                            >
                              <RotateCcw size={14} />
                              Solicitar reenvio
                            </button>
                            <button
                              disabled={busy}
                              className={styles.dangerAction}
                              onClick={() =>
                                act(
                                  `/api/admin/identity-verifications/${row.id}`,
                                  "rejected",
                                  true,
                                )
                              }
                            >
                              Rejeitar
                            </button>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.empty}>
                  <div>
                    <strong>Nenhuma identidade aguardando histórico</strong>
                    <p>As verificações enviadas aparecerão aqui para conferência.</p>
                  </div>
                </div>
              )
            ) : tab === "Chaves Pix" ? (
              pix.length ? (
                <div className={styles.cards}>
                  {pix.map((row) => (
                    <article className={styles.reviewCard} key={row.id}>
                      <div className={styles.reviewTop}>
                        <div className={styles.person}>
                          <span className={styles.avatar}>
                            <WalletCards size={18} />
                          </span>
                          <div className={styles.personText}>
                            <strong>
                              {row.user_full_name ?? row.holder_name ?? "Usuário"}
                            </strong>
                            <span>{row.email ?? "E-mail não encontrado"}</span>
                          </div>
                        </div>
                        <span className={badgeClass(row.status)}>
                          {STATUS_LABELS[row.status ?? ""] ?? row.status ?? "—"}
                        </span>
                      </div>

                      <div className={styles.details}>
                        <div className={styles.detail}>
                          <span>Tipo da chave</span>
                          <strong>{PIX_TYPE_LABELS[row.key_type ?? ""] ?? row.key_type ?? "—"}</strong>
                        </div>
                        <div className={styles.detail}>
                          <span>Chave Pix</span>
                          <code>{row.key_value || `•••• ${row.key_last4 ?? ""}`}</code>
                        </div>
                        <div className={styles.detail}>
                          <span>Titular</span>
                          <strong>{row.holder_name ?? "—"}</strong>
                        </div>
                        <div className={styles.detail}>
                          <span>CPF/CNPJ do titular</span>
                          <strong>•••• {row.holder_tax_id_last4 ?? "—"}</strong>
                        </div>
                        <div className={styles.detail}>
                          <span>Cadastrada em</span>
                          <strong>{formatDate(row.created_at)}</strong>
                        </div>
                        <div className={styles.detail}>
                          <span>Uso</span>
                          <strong>{row.is_primary ? "Chave principal" : "Chave adicional"}</strong>
                        </div>
                      </div>

                      {row.status === "pending" && (
                        <div className={styles.actions}>
                          <button
                            disabled={busy}
                            className={styles.approveAction}
                            onClick={() =>
                              act(`/api/admin/payout-accounts/${row.id}`, "verified")
                            }
                          >
                            <BadgeCheck size={14} />
                            Verificar chave
                          </button>
                          <button
                            disabled={busy}
                            className={styles.dangerAction}
                            onClick={() =>
                              act(`/api/admin/payout-accounts/${row.id}`, "rejected")
                            }
                          >
                            Rejeitar
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <div className={styles.empty}>
                  <div>
                    <strong>Nenhuma chave Pix cadastrada</strong>
                    <p>As chaves enviadas pelos usuários aparecerão aqui com os dados para conferência.</p>
                  </div>
                </div>
              )
            ) : currentItems.length ? (
              <div className={styles.genericRows}>
                {currentItems.map((row) => (
                  <div className={styles.genericRow} key={row.id}>
                    <strong>
                      {row.legal_name ??
                        row.holder_name ??
                        row.full_name ??
                        row.external_account_id ??
                        row.action ??
                        row.email ??
                        row.id.slice(0, 8)}
                    </strong>

                    <span>
                      {STATUS_LABELS[row.status ?? ""] ?? row.status ?? ""}
                      {row.amount_cents != null
                        ? ` · ${formatCents(row.amount_cents)}`
                        : row.gross_amount_cents != null
                          ? ` · ${formatCents(row.gross_amount_cents)}`
                          : ""}
                      {" · "}
                      {formatDate(row.created_at ?? row.submitted_at ?? row.connected_at)}
                    </span>

                    <div className={styles.actions}>
                      {tab === "Saques" &&
                        ["requested", "processing"].includes(row.status ?? "") &&
                        [
                          ...(row.status === "requested"
                            ? ["processing", "rejected"]
                            : ["paid", "failed"]),
                        ].map((status) => (
                          <button
                            disabled={busy}
                            className={
                              status === "paid"
                                ? styles.approveAction
                                : status === "rejected" || status === "failed"
                                  ? styles.dangerAction
                                  : styles.action
                            }
                            key={status}
                            onClick={() =>
                              act(`/api/admin/withdrawals/${row.id}`, status)
                            }
                          >
                            {STATUS_LABELS[status] ?? status}
                          </button>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.empty}>
                <div>
                  <strong>Nenhum registro nesta área</strong>
                  <p>Os novos registros aparecerão automaticamente aqui.</p>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
