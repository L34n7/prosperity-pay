"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Clock3,
  Eye,
  EyeOff,
  FileText,
  Fingerprint,
  Landmark,
  Pencil,
  Plus,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate, requestJson } from "@/lib/operational";
import {
  dateInputLimitForAge,
  formatTaxId,
  isValidTaxId,
  onlyDigits,
  validateAdultBirthDate,
} from "@/lib/validation/br-documents";
import styles from "./account-view.module.css";

type Identity = {
  legal_name: string;
  person_type: "individual" | "business";
  tax_id_last4: string;
  tax_id_value: string | null;
  birth_date: string | null;
  business_name: string | null;
  status: string;
  review_note: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  document_original_name?: string | null;
};

type Balance = {
  available_cents: number;
  pending_cents: number;
  withdrawing_cents: number;
};

type Pix = {
  id: string;
  key_type: "cpf" | "cnpj" | "email" | "phone" | "random_key";
  key_last4: string;
  key_value: string;
  holder_name: string;
  holder_tax_id_last4: string;
  holder_tax_id_value: string | null;
  status: string;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
};

const IDENTITY_STATUS: Record<
  string,
  { label: string; title: string; description: string; tone: "pending" | "approved" | "rejected" }
> = {
  under_review: {
    label: "Em análise",
    title: "Verificação enviada para análise",
    description:
      "Seus dados e o documento foram recebidos. O administrador fará a conferência antes de liberar saques.",
    tone: "pending",
  },
  approved: {
    label: "Aprovada",
    title: "Identidade verificada",
    description:
      "Sua identidade foi aprovada. Para solicitar saque, a chave Pix também precisa estar verificada.",
    tone: "approved",
  },
  rejected: {
    label: "Rejeitada",
    title: "Verificação não aprovada",
    description:
      "Revise a observação da análise, corrija os dados necessários e envie novamente.",
    tone: "rejected",
  },
  resubmission_required: {
    label: "Reenvio necessário",
    title: "Precisamos de uma nova conferência",
    description:
      "O administrador solicitou correção dos dados ou um novo documento. Edite e reenvie para análise.",
    tone: "rejected",
  },
};

const PIX_STATUS: Record<
  string,
  { label: string; description: string; tone: "pending" | "approved" | "rejected" }
> = {
  pending: {
    label: "Em análise",
    description: "Aguardando conferência da chave Pix pelo administrador.",
    tone: "pending",
  },
  verified: {
    label: "Verificada",
    description: "Chave aprovada e disponível para receber saques.",
    tone: "approved",
  },
  rejected: {
    label: "Rejeitada",
    description: "A chave não foi aprovada. Cadastre outra chave para nova análise.",
    tone: "rejected",
  },
};

const PIX_TYPE_LABELS: Record<Pix["key_type"], string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  phone: "Telefone",
  random_key: "Chave aleatória",
};

function statusClass(tone: "pending" | "approved" | "rejected") {
  if (tone === "approved") return `${styles.statusBadge} ${styles.statusApproved}`;
  if (tone === "rejected") return `${styles.statusBadge} ${styles.statusRejected}`;
  return `${styles.statusBadge} ${styles.statusPending}`;
}

function formatPixValue(type: Pix["key_type"], value: string) {
  if (type === "cpf") return formatTaxId(value, "individual");
  if (type === "cnpj") return formatTaxId(value, "business");
  return value;
}

function formatPixInput(type: Pix["key_type"], value: string) {
  if (type === "cpf") return formatTaxId(value, "individual");
  if (type === "cnpj") return formatTaxId(value, "business");
  if (type === "phone") return onlyDigits(value).slice(0, 13);
  return value.slice(0, 180);
}

function formatHolderTaxId(value: string) {
  const digits = onlyDigits(value).slice(0, 14);
  return digits.length > 11
    ? formatTaxId(digits, "business")
    : formatTaxId(digits, "individual");
}

function maskedTaxId(personType: "individual" | "business", last4: string) {
  return personType === "business"
    ? `••.•••.•••/••••-${last4}`
    : `•••.•••.•••-${last4}`;
}

export function AccountView() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [pix, setPix] = useState<Pix[]>([]);
  const [balance, setBalance] = useState<Balance>({
    available_cents: 0,
    pending_cents: 0,
    withdrawing_cents: 0,
  });
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [identityEditing, setIdentityEditing] = useState(false);
  const [pixFormOpen, setPixFormOpen] = useState(false);
  const [pixEditingId, setPixEditingId] = useState<string | null>(null);
  const [personType, setPersonType] = useState<"individual" | "business">("individual");
  const [taxId, setTaxId] = useState("");
  const [pixKeyType, setPixKeyType] = useState<Pix["key_type"]>("cpf");
  const [pixKey, setPixKey] = useState("");
  const [holderTaxId, setHolderTaxId] = useState("");
  const [pixHolderName, setPixHolderName] = useState("");
  const [identityTaxVisible, setIdentityTaxVisible] = useState(false);

  const minBirthDate = useMemo(() => dateInputLimitForAge(120), []);
  const maxBirthDate = useMemo(() => dateInputLimitForAge(18), []);

  const load = useCallback(async () => {
    try {
      const [identityResponse, pixResponse, balanceResponse] = await Promise.all([
        requestJson<{ verification: Identity | null }>("/api/financial-profile/identity"),
        requestJson<{ payoutAccounts: Pix[] }>("/api/financial-profile/pix"),
        requestJson<{ balance: Balance }>("/api/balance"),
      ]);

      setIdentity(identityResponse.verification);
      setPix(pixResponse.payoutAccounts);
      setBalance(balanceResponse.balance);

      if (identityResponse.verification) {
        setPersonType(identityResponse.verification.person_type);
        setTaxId(
          identityResponse.verification.tax_id_value
            ? formatTaxId(
                identityResponse.verification.tax_id_value,
                identityResponse.verification.person_type,
              )
            : "",
        );
        setIdentityEditing(
          ["rejected", "resubmission_required"].includes(
            identityResponse.verification.status,
          ),
        );
      } else {
        setIdentityEditing(true);
      }

      if (!pixResponse.payoutAccounts.length) {
        setPixFormOpen(true);
      }

      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    void createClient()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? ""));
  }, [load]);

  async function sendIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const rawTaxId = String(form.get("taxId") ?? "");

    if (!isValidTaxId(rawTaxId, personType)) {
      setError(personType === "individual" ? "CPF inválido." : "CNPJ inválido.");
      return;
    }

    if (personType === "individual") {
      const birthDate = String(form.get("birthDate") ?? "");
      const validation = validateAdultBirthDate(birthDate);
      if (!validation.valid) {
        setError(validation.error ?? "Data de nascimento inválida.");
        return;
      }
    }

    const document = form.get("document");
    const hasNewDocument = document instanceof File && document.size > 0;
    if (!hasNewDocument && !identity?.document_original_name) {
      setError("Envie uma foto ou PDF do documento com foto.");
      return;
    }
    if (hasNewDocument && document.size > 5 * 1024 * 1024) {
      setError("O documento deve ter no máximo 5 MB.");
      return;
    }

    if (identity) form.set("replaceExisting", "true");

    setBusy(true);
    setError("");
    setMessage("");

    try {
      const response = await fetch("/api/financial-profile/identity", {
        method: "POST",
        body: form,
        cache: "no-store",
      });
      const json = await response.json();

      if (!response.ok) {
        throw new Error(json.error || "Não foi possível enviar a verificação.");
      }

      setTaxId("");
      setIdentityEditing(false);
      await load();
      setMessage("Verificação reenviada. O status voltou para Em análise.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao enviar a verificação.",
      );
    } finally {
      setBusy(false);
    }
  }

  function resetPixForm() {
    setPixEditingId(null);
    setPixKeyType("cpf");
    setPixKey("");
    setPixHolderName("");
    setHolderTaxId("");
    setPixFormOpen(false);
  }

  function editPix(item: Pix) {
    setPixEditingId(item.id);
    setPixKeyType(item.key_type);
    setPixKey(formatPixValue(item.key_type, item.key_value));
    setPixHolderName(item.holder_name);
    const holderDocument =
      item.holder_tax_id_value ??
      (["cpf", "cnpj"].includes(item.key_type) &&
      item.key_last4 === item.holder_tax_id_last4
        ? item.key_value
        : "");
    setHolderTaxId(holderDocument ? formatHolderTaxId(holderDocument) : "");
    setPixFormOpen(true);
    setError("");
  }

  async function sendPix(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson("/api/financial-profile/pix", {
        method: pixEditingId ? "PATCH" : "POST",
        body: JSON.stringify({
          id: pixEditingId,
          keyType: pixKeyType,
          pixKey,
          holderName: pixHolderName,
          holderTaxId,
          isPrimary: pix.length === 0,
        }),
      });

      const edited = Boolean(pixEditingId);
      resetPixForm();
      await load();
      setMessage(
        edited
          ? "Chave Pix atualizada e reenviada para análise."
          : "Chave Pix cadastrada e enviada para análise.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar a chave Pix.");
    } finally {
      setBusy(false);
    }
  }

  async function requestWithdrawal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const amountCents = Math.round(Number(form.get("amount")) * 100);
    const payoutAccountId = String(form.get("payoutAccountId") ?? "");

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setError("Informe um valor de saque válido.");
      return;
    }
    if (amountCents > balance.available_cents) {
      setError("O valor solicitado é maior que o saldo disponível.");
      return;
    }
    if (!payoutAccountId) {
      setError("Escolha uma chave Pix verificada.");
      return;
    }
    if (!confirm(`Solicitar saque de R$ ${(amountCents / 100).toFixed(2).replace(".", ",")}?`)) {
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await requestJson("/api/withdrawals", {
        method: "POST",
        body: JSON.stringify({ amountCents, payoutAccountId }),
      });
      await load();
      setMessage("Solicitação de saque enviada para análise.");
      event.currentTarget.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao solicitar saque.");
    } finally {
      setBusy(false);
    }
  }

  const identityState = identity
    ? IDENTITY_STATUS[identity.status] ?? IDENTITY_STATUS.under_review
    : null;

  return (
    <>
      <PageHeader title="Minha conta" description={email} />

      <div className={styles.pageStack}>
        {error && (
          <div className={`${styles.notice} ${styles.noticeError}`} role="alert">
            <AlertTriangle size={17} />
            <span>{error}</span>
          </div>
        )}

        {message && (
          <div className={`${styles.notice} ${styles.noticeSuccess}`} role="status">
            <BadgeCheck size={17} />
            <span>{message}</span>
          </div>
        )}

        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <div className={styles.sectionTitle}>
              <span className={styles.sectionIcon}>
                <Fingerprint size={19} />
              </span>
              <div>
                <h2>Verificação de identidade</h2>
                <p>Confirmação necessária para proteger o saldo e liberar solicitações de saque.</p>
              </div>
            </div>

            {identityState && (
              <span className={statusClass(identityState.tone)}>
                {identityState.label}
              </span>
            )}
          </header>

          <div className={styles.sectionBody}>
            {identity && identityState ? (
              <>
                <div
                  className={[
                    styles.reviewBanner,
                    identityState.tone === "rejected" ? styles.reviewBannerRejected : "",
                    identityState.tone === "approved" ? styles.reviewBannerApproved : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <div>
                    <strong>{identityState.title}</strong>
                    <p>{identityState.description}</p>
                    {identity.review_note && (
                      <p>
                        <strong>Observação da análise:</strong> {identity.review_note}
                      </p>
                    )}
                  </div>
                  {identityState.tone === "pending" && <Clock3 size={19} />}
                  {identityState.tone === "approved" && <ShieldCheck size={19} />}
                  {identityState.tone === "rejected" && <AlertTriangle size={19} />}
                </div>

                {identity.status === "approved" ? (
                  <div className={styles.detailsGrid}>
                    <div className={styles.detailCard}>
                      <span>Nome / responsável</span>
                      <strong>{identity.legal_name}</strong>
                    </div>
                    <div className={styles.detailCard}>
                      <span>Tipo</span>
                      <strong>
                        {identity.person_type === "business"
                          ? "Pessoa jurídica"
                          : "Pessoa física"}
                      </strong>
                    </div>
                    <div className={styles.detailCard}>
                      <span>{identity.person_type === "business" ? "CNPJ" : "CPF"}</span>
                      <div className={styles.sensitiveValue}>
                        <strong>
                          {identityTaxVisible && identity.tax_id_value
                            ? formatTaxId(identity.tax_id_value, identity.person_type)
                            : maskedTaxId(identity.person_type, identity.tax_id_last4)}
                        </strong>
                        {identity.tax_id_value ? (
                          <button
                            type="button"
                            className={styles.revealButton}
                            onClick={() => setIdentityTaxVisible((visible) => !visible)}
                          >
                            {identityTaxVisible ? <EyeOff size={17} /> : <Eye size={17} />}
                            {identityTaxVisible ? "Ocultar" : "Exibir"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className={styles.detailCard}>
                      <span>Enviado em</span>
                      <strong>{formatDate(identity.submitted_at)}</strong>
                    </div>
                    <div className={styles.detailCard}>
                      <span>
                        {identity.person_type === "business" ? "Razão social" : "Nascimento"}
                      </span>
                      <strong>
                        {identity.person_type === "business"
                          ? identity.business_name || "—"
                          : formatDate(identity.birth_date)}
                      </strong>
                    </div>
                    <div className={styles.detailCard}>
                      <span>Documento</span>
                      <strong>{identity.document_original_name || "Documento legado"}</strong>
                    </div>
                  </div>
                ) : identity.status === "under_review" ? (
                  <div className={styles.analysisSummary}>
                    <div>
                      <span>Nome</span>
                      <strong>{identity.legal_name}</strong>
                    </div>
                    <div>
                      <span>{identity.person_type === "business" ? "CNPJ" : "CPF"}</span>
                      <strong>{maskedTaxId(identity.person_type, identity.tax_id_last4)}</strong>
                    </div>
                    <div>
                      <span>
                        {identity.person_type === "business" ? "Razão social" : "Nascimento"}
                      </span>
                      <strong>
                        {identity.person_type === "business"
                          ? identity.business_name || "—"
                          : formatDate(identity.birth_date)}
                      </strong>
                    </div>
                    <div>
                      <span>Documento</span>
                      <strong>{identity.document_original_name || "Documento enviado"}</strong>
                    </div>
                    <div className={styles.analysisWaiting}>
                      <Clock3 size={18} />
                      <div>
                        <strong>Aguardando análise</strong>
                        <small>Os campos ficam bloqueados até a decisão do administrador.</small>
                      </div>
                    </div>
                  </div>
                ) : null}

                {identity.status === "approved" && !identityEditing && (
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.secondaryAction}
                      onClick={() => {
                        setPersonType(identity.person_type);
                        setTaxId(
                          identity.tax_id_value
                            ? formatTaxId(identity.tax_id_value, identity.person_type)
                            : "",
                        );
                        setIdentityEditing(true);
                        setError("");
                      }}
                    >
                      <Pencil size={15} />
                      Editar dados e reenviar para análise
                    </button>
                  </div>
                )}
              </>
            ) : (
              !identityEditing && (
                <div className={styles.emptyState}>
                  <div>
                    <strong>Nenhuma verificação enviada</strong>
                    <p>Envie seus dados e um documento com foto para iniciar a análise.</p>
                  </div>
                </div>
              )
            )}

            {identityEditing && (
              <form
                className={styles.formPanel}
                onSubmit={sendIdentity}
                encType="multipart/form-data"
              >
                <div className={styles.formPanelHead}>
                  <div>
                    <h3>
                      {!identity
                        ? "Enviar identidade"
                        : ["rejected", "resubmission_required"].includes(identity.status)
                          ? "Corrigir dados e enviar nova análise"
                          : "Editar e reenviar identidade"}
                    </h3>
                    <p>
                      {identity?.status === "rejected" || identity?.status === "resubmission_required"
                        ? "Corrija os dados apontados na análise. Ao enviar, o status volta para Em análise."
                        : "O novo envio ficará Em análise até uma nova conferência administrativa."}
                    </p>
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.field}>
                    <span>Tipo de pessoa</span>
                    <select
                      name="personType"
                      value={personType}
                      onChange={(event) => {
                        const value =
                          event.target.value === "business" ? "business" : "individual";
                        setPersonType(value);
                        setTaxId("");
                        setError("");
                      }}
                    >
                      <option value="individual">Pessoa física</option>
                      <option value="business">Pessoa jurídica</option>
                    </select>
                  </div>

                  <div className={styles.field}>
                    <span>{personType === "individual" ? "CPF" : "CNPJ"}</span>
                    <input
                      name="taxId"
                      required
                      inputMode="numeric"
                      autoComplete="off"
                      value={taxId}
                      maxLength={personType === "individual" ? 14 : 18}
                      placeholder={
                        personType === "individual"
                          ? "000.000.000-00"
                          : "00.000.000/0000-00"
                      }
                      onChange={(event) =>
                        setTaxId(formatTaxId(event.target.value, personType))
                      }
                    />
                    <small>O documento é validado antes de permitir o envio.</small>
                  </div>

                  <div className={styles.field}>
                    <span>
                      {personType === "individual" ? "Nome legal" : "Nome do responsável"}
                    </span>
                    <input
                      name="legalName"
                      required
                      maxLength={180}
                      autoComplete="name"
                      defaultValue={identity?.legal_name ?? ""}
                    />
                  </div>

                  {personType === "individual" ? (
                    <div className={styles.field}>
                      <span>Data de nascimento</span>
                      <input
                        name="birthDate"
                        type="date"
                        required
                        min={minBirthDate}
                        max={maxBirthDate}
                        defaultValue={identity?.birth_date ?? ""}
                      />
                      <small>Somente maiores de 18 anos e idade máxima de 120 anos.</small>
                    </div>
                  ) : (
                    <div className={styles.field}>
                      <span>Razão social</span>
                      <input
                        name="businessName"
                        required
                        maxLength={180}
                        defaultValue={identity?.business_name ?? ""}
                      />
                    </div>
                  )}

                  <div className={`${styles.field} ${styles.fullSpan}`}>
                    <span>Documento com foto</span>
                    <input
                      name="document"
                      type="file"
                      required={!identity?.document_original_name}
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                    />
                    <small>
                      {identity?.document_original_name
                        ? `Documento atual: ${identity.document_original_name}. Deixe vazio para manter ou selecione outro para substituir.`
                        : "RG, CNH ou documento equivalente. JPG, PNG, WEBP ou PDF até 5 MB."}
                    </small>
                  </div>

                  <div className={styles.formActions}>
                    {identity?.status === "approved" && (
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={() => {
                          setIdentityEditing(false);
                          setTaxId(
                            identity.tax_id_value
                              ? formatTaxId(identity.tax_id_value, identity.person_type)
                              : "",
                          );
                          setError("");
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                    <button className={styles.primaryAction} disabled={busy}>
                      {busy
                        ? "Enviando..."
                        : identity && ["rejected", "resubmission_required"].includes(identity.status)
                          ? "Enviar nova análise"
                          : "Enviar para análise"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </section>

        <section className={styles.section}>
          <header className={styles.sectionHead}>
            <div className={styles.sectionTitle}>
              <span className={styles.sectionIcon}>
                <WalletCards size={19} />
              </span>
              <div>
                <h2>Chaves Pix</h2>
                <p>Cadastre a chave que poderá receber os saques aprovados da Prosperity Pay.</p>
              </div>
            </div>

            {pix.length > 0 && !pixFormOpen && (
              <button
                type="button"
                className={styles.secondaryAction}
                onClick={() => setPixFormOpen(true)}
              >
                <Plus size={15} />
                Nova chave
              </button>
            )}
          </header>

          <div className={styles.sectionBody}>
            {pix.length ? (
              <div className={styles.pixList}>
                {pix.map((item) => {
                  const state = PIX_STATUS[item.status] ?? PIX_STATUS.pending;
                  return (
                    <article className={styles.pixCard} key={item.id}>
                      <div className={styles.pixPrimary}>
                        <span className={styles.pixTypeIcon}>
                          <Landmark size={17} />
                        </span>
                        <div>
                          <small>
                            {PIX_TYPE_LABELS[item.key_type]}
                            {item.is_primary ? " · Principal" : ""}
                          </small>
                          <strong className={styles.pixValue}>
                            {formatPixValue(item.key_type, item.key_value)}
                          </strong>
                        </div>
                      </div>

                      <div className={styles.pixMeta}>
                        <small>Titular</small>
                        <strong>{item.holder_name}</strong>
                        <small>CPF/CNPJ final •••• {item.holder_tax_id_last4}</small>
                      </div>

                      <div className={styles.pixStatus}>
                        <span className={statusClass(state.tone)}>{state.label}</span>
                        <small>{state.description}</small>
                        <small>Cadastrada em {formatDate(item.created_at)}</small>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <div>
                  <strong>Nenhuma chave cadastrada</strong>
                  <p>Cadastre uma chave Pix para que ela possa ser conferida pelo administrador.</p>
                </div>
              </div>
            )}

            {pixFormOpen && (
              <form className={styles.formPanel} onSubmit={sendPix}>
                <div className={styles.formPanelHead}>
                  <div>
                    <h3>Cadastrar chave Pix</h3>
                    <p>Após o envio, a chave ficará Em análise até a conferência administrativa.</p>
                  </div>
                </div>

                <div className={styles.formGrid}>
                  <div className={styles.field}>
                    <span>Tipo de chave</span>
                    <select
                      name="keyType"
                      value={pixKeyType}
                      onChange={(event) => {
                        setPixKeyType(event.target.value as Pix["key_type"]);
                        setPixKey("");
                      }}
                    >
                      <option value="cpf">CPF</option>
                      <option value="cnpj">CNPJ</option>
                      <option value="email">E-mail</option>
                      <option value="phone">Telefone</option>
                      <option value="random_key">Aleatória</option>
                    </select>
                  </div>

                  <div className={styles.field}>
                    <span>Chave Pix</span>
                    <input
                      name="pixKey"
                      required
                      value={pixKey}
                      placeholder={
                        pixKeyType === "cpf"
                          ? "000.000.000-00"
                          : pixKeyType === "cnpj"
                            ? "00.000.000/0000-00"
                            : pixKeyType === "email"
                              ? "financeiro@empresa.com.br"
                              : pixKeyType === "phone"
                                ? "5531999999999"
                                : "Chave aleatória"
                      }
                      onChange={(event) =>
                        setPixKey(formatPixInput(pixKeyType, event.target.value))
                      }
                    />
                  </div>

                  <div className={styles.field}>
                    <span>Nome do titular</span>
                    <input name="holderName" required maxLength={180} />
                  </div>

                  <div className={styles.field}>
                    <span>CPF/CNPJ do titular</span>
                    <input
                      name="holderTaxId"
                      required
                      inputMode="numeric"
                      maxLength={18}
                      value={holderTaxId}
                      placeholder="CPF ou CNPJ"
                      onChange={(event) =>
                        setHolderTaxId(formatHolderTaxId(event.target.value))
                      }
                    />
                  </div>

                  <div className={styles.formActions}>
                    {pix.length > 0 && (
                      <button
                        type="button"
                        className={styles.secondaryAction}
                        onClick={() => {
                          setPixFormOpen(false);
                          setPixKey("");
                          setHolderTaxId("");
                        }}
                      >
                        Cancelar
                      </button>
                    )}
                    <button className={styles.primaryAction} disabled={busy}>
                      {busy ? "Enviando..." : "Enviar chave para análise"}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </section>

        <div className={styles.simpleLinks}>
          <Link href="/integracoes" className={styles.simpleCard}>
            <div>
              <strong>Mercado Pago</strong>
              <small>Gerencie a integração financeira da sua conta.</small>
            </div>
            <Landmark size={18} />
          </Link>
          <Link href="/esqueci-senha" className={styles.simpleCard}>
            <div>
              <strong>Segurança</strong>
              <small>Altere sua senha por meio do e-mail da conta.</small>
            </div>
            <FileText size={18} />
          </Link>
        </div>
      </div>
    </>
  );
}
