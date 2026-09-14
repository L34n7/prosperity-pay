"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { formatDate, requestJson } from "@/lib/operational";

type Connection = {
  id: string;
  external_account_id: string;
  status: string;
  live_mode: boolean;
  connected_at: string;
  updated_at: string;
};

export function PlatformSettings({ connection, tokenConfigured }: { connection: Connection | null; tokenConfigured: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function configure() {
    if (!confirm(connection ? "Validar novamente e atualizar a conta central da Prosperity?" : "Configurar a conta central da Prosperity usando a credencial segura do servidor?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await requestJson<{ accountId: string }>("/api/admin/payment-connections/platform", { method: "POST", body: "{}" });
      setMessage(`Conta central validada com sucesso: ${result.accountId}.`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível configurar a conta central.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageHeader title="Configuração da plataforma" description="Área exclusiva do administrador para serviços centrais do Prosperity Pay." />
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-success" role="status">{message}</p>}
    <section className="panel operational-panel">
      <h2>Conta Mercado Pago central</h2>
      <p>Esta conta recebe os pagamentos dos produtos configurados como <strong>Saldo Prosperity</strong>. A credencial fica somente no servidor e nunca é exibida nesta página.</p>
      <div className="records-list">
        <div className="record-row"><strong>Credencial do servidor</strong><span>{tokenConfigured ? "Configurada" : "Não configurada"}</span><span>MERCADO_PAGO_ACCESS_TOKEN</span></div>
        <div className="record-row"><strong>Conexão central</strong><span>{connection ? connection.status : "Não configurada"}</span><span>{connection ? `Conta ${connection.external_account_id}` : "—"}</span></div>
        {connection && <div className="record-row"><strong>Ambiente</strong><span>{connection.live_mode ? "Produção" : "Teste"}</span><span>Conectada em {formatDate(connection.connected_at)}</span></div>}
      </div>
      {!tokenConfigured && <p className="form-error">Configure primeiro a variável <strong>MERCADO_PAGO_ACCESS_TOKEN</strong> da conta Mercado Pago da Prosperity na Vercel.</p>}
      <div className="button-row">
        <button className="primary-button" disabled={busy || !tokenConfigured} onClick={() => void configure()}>{busy ? "Validando..." : connection ? "Validar e atualizar conexão" : "Configurar conta central"}</button>
      </div>
      <p className="form-hint">O botão consulta a conta diretamente no Mercado Pago, identifica o ID da conta e registra a conexão como <strong>prosperity_balance</strong>. Nenhum token é enviado ao navegador.</p>
    </section>
  </>;
}
