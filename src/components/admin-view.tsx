"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExternalLink, FileCheck2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { formatCents, formatDate, requestJson } from "@/lib/operational";

type Row = {
  id: string;
  status?: string;
  created_at?: string;
  submitted_at?: string;
  connected_at?: string;
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
};

const STATUS_LABELS: Record<string, string> = {
  under_review: "Em análise",
  approved: "Aprovada",
  rejected: "Rejeitada",
  resubmission_required: "Reenvio necessário",
  pending: "Pendente",
  verified: "Verificada",
  requested: "Solicitado",
  processing: "Processando",
  paid: "Pago",
  failed: "Falhou",
  cancelled: "Cancelado",
};

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

  return (
    <>
      <PageHeader
        title="Admin Prosperity"
        description="Revisão financeira e operações da plataforma."
      />

      <nav className="detail-tabs">
        {Object.keys(groups).map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={tab === name ? "active" : ""}
          >
            {name}
          </button>
        ))}
      </nav>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <section className="panel operational-panel">
        <h2>{tab}</h2>

        {tab === "Identidade" ? (
          identity.length ? (
            <div style={{ display: "grid", gap: 12 }}>
              {identity.map((row) => (
                <article className="panel" key={row.id} style={{ padding: 16 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 16,
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "grid", gap: 6 }}>
                      <strong>{row.legal_name ?? row.user_full_name ?? "Usuário"}</strong>
                      <span>{row.email ?? "E-mail não encontrado"}</span>
                      <span>
                        {row.person_type === "business" ? "Pessoa jurídica" : "Pessoa física"}
                        {" · "}
                        {row.person_type === "business" ? "CNPJ" : "CPF"} final{" "}
                        {row.tax_id_last4 ? `••••${row.tax_id_last4}` : "—"}
                      </span>
                      {row.person_type === "business" ? (
                        <span>Razão social: {row.business_name ?? "—"}</span>
                      ) : (
                        <span>Nascimento: {formatDate(row.birth_date)}</span>
                      )}
                      <span>
                        Status: {STATUS_LABELS[row.status ?? ""] ?? row.status ?? "—"} · Enviado em{" "}
                        {formatDate(row.submitted_at)}
                      </span>
                      {row.review_note && <span>Observação: {row.review_note}</span>}
                    </div>

                    <div className="button-row">
                      {row.document_url ? (
                        <a
                          className="secondary-button"
                          href={row.document_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={15} />
                          Ver documento
                        </a>
                      ) : (
                        <span>Sem documento anexado</span>
                      )}
                    </div>
                  </div>

                  {row.status === "under_review" && (
                    <div className="button-row" style={{ marginTop: 14 }}>
                      <button
                        disabled={busy}
                        className="secondary-button"
                        onClick={() =>
                          act(
                            `/api/admin/identity-verifications/${row.id}`,
                            "approved",
                            true,
                          )
                        }
                      >
                        <FileCheck2 size={15} />
                        Aprovar
                      </button>
                      <button
                        disabled={busy}
                        className="secondary-button"
                        onClick={() =>
                          act(
                            `/api/admin/identity-verifications/${row.id}`,
                            "resubmission_required",
                            true,
                          )
                        }
                      >
                        Solicitar novo documento
                      </button>
                      <button
                        disabled={busy}
                        className="secondary-button"
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
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p>Nenhuma verificação de identidade enviada.</p>
          )
        ) : groups[tab].length ? (
          groups[tab].map((row) => (
            <div className="record-row" key={row.id}>
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
                {" · "}
                {row.amount_cents != null
                  ? formatCents(row.amount_cents)
                  : row.gross_amount_cents != null
                    ? formatCents(row.gross_amount_cents)
                    : ""}
                {" · "}
                {formatDate(row.created_at ?? row.submitted_at ?? row.connected_at)}
              </span>
              <span className="button-row">
                {tab === "Chaves Pix" &&
                  row.status === "pending" &&
                  ["verified", "rejected"].map((status) => (
                    <button
                      disabled={busy}
                      className="secondary-button"
                      key={status}
                      onClick={() =>
                        act(`/api/admin/payout-accounts/${row.id}`, status)
                      }
                    >
                      {STATUS_LABELS[status] ?? status}
                    </button>
                  ))}

                {tab === "Saques" &&
                  ["requested", "processing"].includes(row.status ?? "") &&
                  [
                    ...(row.status === "requested"
                      ? ["processing", "rejected"]
                      : ["paid", "failed"]),
                  ].map((status) => (
                    <button
                      disabled={busy}
                      className="secondary-button"
                      key={status}
                      onClick={() =>
                        act(`/api/admin/withdrawals/${row.id}`, status)
                      }
                    >
                      {STATUS_LABELS[status] ?? status}
                    </button>
                  ))}
              </span>
            </div>
          ))
        ) : (
          <p>Nenhum registro nesta área.</p>
        )}
      </section>
    </>
  );
}
