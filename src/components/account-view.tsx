"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { requestJson } from "@/lib/operational";
import {
  dateInputLimitForAge,
  formatTaxId,
  isValidTaxId,
  validateAdultBirthDate,
} from "@/lib/validation/br-documents";

type Identity = {
  legal_name: string;
  person_type: "individual" | "business";
  status: string;
  review_note: string | null;
  document_original_name?: string | null;
};

type Pix = {
  id: string;
  key_type: string;
  key_last4: string;
  status: string;
  is_primary: boolean;
};

const STATUS_LABELS: Record<string, string> = {
  under_review: "Em análise",
  approved: "Aprovada",
  rejected: "Rejeitada",
  resubmission_required: "Reenvio necessário",
};

export function AccountView() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [pix, setPix] = useState<Pix[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [personType, setPersonType] = useState<"individual" | "business">("individual");
  const [taxId, setTaxId] = useState("");

  const minBirthDate = useMemo(() => dateInputLimitForAge(120), []);
  const maxBirthDate = useMemo(() => dateInputLimitForAge(18), []);

  const load = useCallback(async () => {
    try {
      const [identityResponse, pixResponse] = await Promise.all([
        requestJson<{ verification: Identity | null }>("/api/financial-profile/identity"),
        requestJson<{ payoutAccounts: Pix[] }>("/api/financial-profile/pix"),
      ]);
      setIdentity(identityResponse.verification);
      setPix(pixResponse.payoutAccounts);
      setError("");
    } catch (cause) {
      setError(String(cause));
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
    void createClient()
      .auth.getUser()
      .then(({ data }) => setEmail(data.user?.email ?? ""));
  }, [load]);

  async function submitJson(path: string, data: object) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestJson(path, {
        method: "POST",
        body: JSON.stringify(data),
      });
      await load();
      setMessage("Dados enviados para análise.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }

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
    if (!(document instanceof File) || document.size <= 0) {
      setError("Envie uma foto ou PDF do documento com foto.");
      return;
    }
    if (document.size > 5 * 1024 * 1024) {
      setError("O documento deve ter no máximo 5 MB.");
      return;
    }

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

      await load();
      setMessage("Verificação enviada para análise do administrador.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao enviar a verificação.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendPix(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await submitJson("/api/financial-profile/pix", {
      keyType: form.get("keyType"),
      pixKey: form.get("pixKey"),
      holderName: form.get("holderName"),
      holderTaxId: form.get("holderTaxId"),
      isPrimary: pix.length === 0,
    });
  }

  const canSubmitIdentity =
    !identity || ["rejected", "resubmission_required"].includes(identity.status);

  return (
    <>
      <PageHeader title="Minha conta" description={email} />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-success" role="status">
          {message}
        </p>
      )}

      <section className="panel operational-panel">
        <h2>Verificação de identidade</h2>
        <p>
          {identity
            ? `${identity.legal_name} · ${STATUS_LABELS[identity.status] ?? identity.status}`
            : "Ainda não enviada"}
        </p>
        {identity?.document_original_name && (
          <p>Documento enviado: {identity.document_original_name}</p>
        )}
        {identity?.review_note && <p>Observação: {identity.review_note}</p>}

        {canSubmitIdentity && (
          <form
            className="operational-form form-grid"
            onSubmit={sendIdentity}
            encType="multipart/form-data"
          >
            <label>
              Tipo de pessoa
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
            </label>

            <label>
              {personType === "individual" ? "Nome legal" : "Nome do responsável"}
              <input name="legalName" required maxLength={180} autoComplete="name" />
            </label>

            <label>
              {personType === "individual" ? "CPF" : "CNPJ"}
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
                onBlur={() => {
                  if (taxId && !isValidTaxId(taxId, personType)) {
                    setError(
                      personType === "individual" ? "CPF inválido." : "CNPJ inválido.",
                    );
                  } else {
                    setError("");
                  }
                }}
              />
            </label>

            {personType === "individual" ? (
              <label>
                Data de nascimento
                <input
                  name="birthDate"
                  type="date"
                  required
                  min={minBirthDate}
                  max={maxBirthDate}
                />
                <small>Somente maiores de 18 anos. Datas irreais são bloqueadas.</small>
              </label>
            ) : (
              <label>
                Razão social
                <input name="businessName" required maxLength={180} />
              </label>
            )}

            <label>
              Documento com foto
              <input
                name="document"
                type="file"
                required
                accept="image/jpeg,image/png,image/webp,application/pdf"
              />
              <small>RG, CNH ou documento equivalente. JPG, PNG, WEBP ou PDF até 5 MB.</small>
            </label>

            <button className="primary-button" disabled={busy}>
              {busy ? "Enviando..." : "Enviar para análise"}
            </button>
          </form>
        )}
      </section>

      <section className="panel operational-panel">
        <h2>Chaves Pix</h2>
        {pix.length ? (
          pix.map((item) => (
            <div className="record-row" key={item.id}>
              {item.key_type} · ••••{item.key_last4} · {item.status}
            </div>
          ))
        ) : (
          <p>Nenhuma chave cadastrada.</p>
        )}

        <form className="operational-form form-grid" onSubmit={sendPix}>
          <label>
            Tipo de chave
            <select name="keyType">
              <option value="cpf">CPF</option>
              <option value="cnpj">CNPJ</option>
              <option value="email">E-mail</option>
              <option value="phone">Telefone</option>
              <option value="random_key">Aleatória</option>
            </select>
          </label>
          <label>
            Chave Pix
            <input name="pixKey" required />
          </label>
          <label>
            Nome do titular
            <input name="holderName" required />
          </label>
          <label>
            CPF/CNPJ do titular
            <input name="holderTaxId" required />
          </label>
          <button className="primary-button" disabled={busy}>
            Cadastrar chave
          </button>
        </form>
      </section>

      <section className="panel operational-panel">
        <h2>Mercado Pago</h2>
        <Link href="/integracoes">Ver integração →</Link>
      </section>
      <section className="panel operational-panel">
        <h2>Segurança</h2>
        <Link href="/esqueci-senha">Alterar senha pelo e-mail →</Link>
      </section>
    </>
  );
}
