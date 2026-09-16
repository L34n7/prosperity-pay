"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/operational";

type Integration = {
  id: string;
  name: string;
  webhookUrl: string;
  status: "active" | "disconnected";
  secretLastFour: string;
  lastTestedAt: string | null;
  lastTestStatus: "success" | "failed" | null;
  lastTestHttpStatus: number | null;
  lastTestMessage: string | null;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type Delivery = {
  status: string;
  eventType: string;
  responseStatus: number | null;
  lastError: string | null;
  lastAttemptAt: string | null;
  createdAt: string;
} | null;

type Props = {
  integration: Integration | null;
  fallbackConfigured: boolean;
  activeRouteCount: number;
  lastDelivery: Delivery;
};

type SecretResponse = {
  secret: string;
  integration?: Integration;
  secretLastFour?: string;
};

const DEFAULT_URL = "https://crmprosperity.com/api/webhooks/prosperity-pay";

function formatDateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("pt-BR") : "—";
}

export function CrmProsperityIntegration({ integration, fallbackConfigured, activeRouteCount, lastDelivery }: Props) {
  const router = useRouter();
  const [name, setName] = useState(integration?.name ?? "");
  const [webhookUrl, setWebhookUrl] = useState(integration?.webhookUrl ?? DEFAULT_URL);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [secret, setSecret] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setName(integration?.name ?? "");
    setWebhookUrl(integration?.webhookUrl ?? DEFAULT_URL);
  }, [integration?.name, integration?.webhookUrl]);

  async function run<T>(label: string, action: () => Promise<T>) {
    setBusy(label);
    setError("");
    setMessage("");
    setCopied(false);
    try {
      return await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function createIntegration() {
    const result = await run<SecretResponse>("create", () => requestJson("/api/admin/integrations/crm-prosperity", {
      method: "POST",
      body: JSON.stringify({ name, webhookUrl }),
    }));
    if (!result) return;
    setSecret(result.secret);
    setMessage("Integração criada. Copie o token abaixo e cadastre-o no CRM Prosperity antes de testar.");
    router.refresh();
  }

  async function saveIntegration() {
    const result = await run<{ integration: Integration }>("save", () => requestJson("/api/admin/integrations/crm-prosperity", {
      method: "PATCH",
      body: JSON.stringify({ name, webhookUrl }),
    }));
    if (!result) return;
    setMessage("Configuração atualizada.");
    router.refresh();
  }

  async function action(actionName: "test" | "disconnect" | "reconnect" | "rotate_secret") {
    if (actionName === "disconnect" && !confirm("Desconectar o CRM Prosperity? Novos webhooks deixarão de ser enviados imediatamente.")) return;
    if (actionName === "rotate_secret" && !confirm("Gerar um novo token? O token atual deixará de funcionar e você precisará atualizar PROSPERITY_PAY_WEBHOOK_SECRET no CRM Prosperity.")) return;

    const result = await run<any>(actionName, () => requestJson("/api/admin/integrations/crm-prosperity/action", {
      method: "POST",
      body: JSON.stringify({ action: actionName }),
    }));
    if (!result) return;

    if (actionName === "rotate_secret") {
      setSecret(result.secret);
      setMessage("Novo token gerado. Copie-o agora e substitua PROSPERITY_PAY_WEBHOOK_SECRET no CRM Prosperity.");
    } else if (actionName === "test") {
      setMessage(result.message || "Conexão testada com sucesso.");
    } else if (actionName === "disconnect") {
      setMessage("Integração desconectada. Nenhum novo webhook será enviado ao CRM.");
    } else {
      setMessage("Integração reconectada.");
    }
    router.refresh();
  }

  async function copySecret() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
    } catch {
      setError("Não foi possível copiar automaticamente. Selecione o token e copie manualmente.");
    }
  }

  return <section className="panel operational-panel">
    <h2>CRM Prosperity</h2>
    <p>Envie eventos de pagamento do Prosperity Pay para ativação e renovação automática de planos no CRM.</p>
    <span className={`status-badge ${integration?.status === "active" ? "status-active" : "status-inactive"}`}>
      {integration ? (integration.status === "active" ? "Conectado" : "Desconectado") : "Não configurado"}
    </span>

    {!integration && fallbackConfigured && <p className="muted">Existe uma configuração legada pela Vercel. Ao criar esta integração, o gerenciamento pelo painel passa a ter prioridade e a opção Desconectar prevalece sobre as variáveis de ambiente.</p>}

    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-success" role="status">{message}</p>}

    <div className="operational-form form-grid">
      <label>
        <span>Nome da integração</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Ex.: CRM Prosperity - Produção" />
      </label>
      <label>
        <span>URL do webhook</span>
        <input value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} maxLength={2048} inputMode="url" />
      </label>
    </div>

    {integration && <div className="records-list">
      <div className="record-row"><strong>Token</strong><span>••••••••{integration.secretLastFour}</span><span>Armazenado criptografado</span></div>
      <div className="record-row"><strong>Rotas ativas</strong><span>{activeRouteCount}</span><span>Ofertas enviando eventos ao CRM</span></div>
      <div className="record-row"><strong>Último teste</strong><span>{integration.lastTestStatus === "success" ? "Sucesso" : integration.lastTestStatus === "failed" ? "Falhou" : "Ainda não testado"}</span><span>{formatDateTime(integration.lastTestedAt)}{integration.lastTestHttpStatus ? ` · HTTP ${integration.lastTestHttpStatus}` : ""}</span></div>
      {integration.lastTestMessage && <div className="record-row"><strong>Resultado do teste</strong><span>{integration.lastTestMessage}</span><span>—</span></div>}
      <div className="record-row"><strong>Última entrega</strong><span>{lastDelivery ? lastDelivery.status : "Nenhuma"}</span><span>{lastDelivery ? `${lastDelivery.eventType} · ${formatDateTime(lastDelivery.lastAttemptAt || lastDelivery.createdAt)}` : "—"}</span></div>
      {lastDelivery?.lastError && <div className="record-row"><strong>Último erro</strong><span>{lastDelivery.lastError}</span><span>{lastDelivery.responseStatus ? `HTTP ${lastDelivery.responseStatus}` : "—"}</span></div>}
    </div>}

    {secret && <div className="panel operational-panel">
      <strong>Token secreto — exibido somente agora</strong>
      <p>Cadastre exatamente este valor como <code>PROSPERITY_PAY_WEBHOOK_SECRET</code> no projeto CRM Prosperity.</p>
      <div className="operational-form">
        <input readOnly value={secret} aria-label="Token secreto da integração" />
        <div className="button-row">
        <button type="button" className="secondary-button" onClick={() => void copySecret()}>{copied ? "Copiado" : "Copiar token"}</button>
        </div>
      </div>
      <p className="muted">Depois de sair ou atualizar a página, o token completo não será exibido novamente. Se perder, use “Gerar novo token”.</p>
    </div>}

    {!integration ? <div className="button-row">
      <button type="button" className="primary-button" disabled={Boolean(busy) || !name.trim() || !webhookUrl.trim()} onClick={() => void createIntegration()}>{busy === "create" ? "Criando..." : "Criar integração e gerar token"}</button>
    </div> : <>
      <div className="button-row">
        <button type="button" className="primary-button" disabled={Boolean(busy) || !name.trim() || !webhookUrl.trim()} onClick={() => void saveIntegration()}>{busy === "save" ? "Salvando..." : "Salvar alterações"}</button>
        <button type="button" className="secondary-button" disabled={Boolean(busy) || integration.status !== "active"} onClick={() => void action("test")}>{busy === "test" ? "Testando..." : "Testar conexão"}</button>
      </div>
      <div className="button-row" style={{ marginTop: 8 }}>
        <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void action("rotate_secret")}>{busy === "rotate_secret" ? "Gerando..." : "Gerar novo token"}</button>
        {integration.status === "active"
          ? <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void action("disconnect")}>{busy === "disconnect" ? "Desconectando..." : "Desconectar"}</button>
          : <button type="button" className="primary-button" disabled={Boolean(busy)} onClick={() => void action("reconnect")}>{busy === "reconnect" ? "Reconectando..." : "Reconectar"}</button>}
      </div>
    </>}

    {integration && <p className="muted">Ao desconectar, os históricos permanecem salvos e a variável da Vercel não reativa a integração. A configuração gerenciada pelo painel sempre tem prioridade.</p>}
  </section>;
}
