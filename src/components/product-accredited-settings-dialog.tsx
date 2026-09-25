"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Settings2, ShieldCheck, UsersRound, X } from "lucide-react";
import { requestJson } from "@/lib/operational";
import styles from "./product-affiliate-settings-dialog.module.css";

export type AccreditedProgramSettings = {
  product_id: string;
  active: boolean;
  allow_direct_invites: boolean;
  allow_affiliate_evolution: boolean;
  customer_portfolio_access: boolean;
  customer_contact_access: boolean;
  subscription_details_access: boolean;
  created_at: string | null;
  updated_at: string | null;
};

function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`${styles.switch} ${checked ? styles.switchOn : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function ProductAccreditedSettingsDialog({
  productId,
  settings,
  onClose,
  onSaved,
}: {
  productId: string;
  settings: AccreditedProgramSettings;
  onClose: () => void;
  onSaved: (settings: AccreditedProgramSettings) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [active, setActive] = useState(settings.active);
  const [allowDirectInvites, setAllowDirectInvites] = useState(settings.allow_direct_invites);
  const [allowAffiliateEvolution, setAllowAffiliateEvolution] = useState(settings.allow_affiliate_evolution);
  const [customerPortfolioAccess, setCustomerPortfolioAccess] = useState(settings.customer_portfolio_access);
  const [customerContactAccess, setCustomerContactAccess] = useState(settings.customer_contact_access);
  const [subscriptionDetailsAccess, setSubscriptionDetailsAccess] = useState(settings.subscription_details_access);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await requestJson<{ settings: AccreditedProgramSettings }>(
        `/api/products/${productId}/accredited-settings`,
        {
          method: "PUT",
          body: JSON.stringify({
            active,
            allowDirectInvites,
            allowAffiliateEvolution,
            customerPortfolioAccess,
            customerContactAccess,
            subscriptionDetailsAccess,
          }),
        },
      );
      onSaved(result.settings);
      ref.current?.close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar configurações de credenciados.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      <form className={styles.form} onSubmit={(event) => void submit(event)}>
        <header className={styles.header}>
          <div>
            <span>Programa de credenciados</span>
            <h2>Configurações de credenciamento</h2>
            <p>Defina regras exclusivas dos Credenciados sem alterar o funcionamento dos Afiliados.</p>
          </div>
          <button
            type="button"
            className={styles.close}
            disabled={busy}
            onClick={() => ref.current?.close()}
            aria-label="Fechar"
          >
            <X size={19} />
          </button>
        </header>

        <div className={styles.body}>
          <section className={styles.block}>
            <div className={styles.blockTitle}>
              <span><Settings2 size={17} /></span>
              <div>
                <h3>Disponibilidade</h3>
                <p>Controle a categoria Credenciado dentro deste produto.</p>
              </div>
            </div>
            <div className={styles.toggleList}>
              <div className={styles.toggleRow}>
                <div>
                  <strong>Habilitar credenciados</strong>
                  <small>Quando pausado, novos convites e evoluções ficam indisponíveis. Credenciados existentes não perdem o histórico.</small>
                </div>
                <Switch checked={active} onChange={setActive} label="Habilitar credenciados" />
              </div>
            </div>
          </section>

          <section className={styles.block}>
            <div className={styles.blockTitle}>
              <span><UsersRound size={17} /></span>
              <div>
                <h3>Entrada de credenciados</h3>
                <p>Escolha como novos parceiros podem entrar nesta categoria.</p>
              </div>
            </div>
            <div className={styles.toggleList}>
              <div className={styles.toggleRow}>
                <div>
                  <strong>Permitir convite direto</strong>
                  <small>Libera o botão “Convidar credenciado” para contas Prosperity Pay.</small>
                </div>
                <Switch
                  checked={allowDirectInvites}
                  disabled={!active}
                  onChange={setAllowDirectInvites}
                  label="Permitir convite direto"
                />
              </div>
              <div className={styles.toggleRow}>
                <div>
                  <strong>Permitir evolução de Afiliado</strong>
                  <small>Permite transformar um Afiliado ativo em Credenciado sem perder link, clientes, histórico ou comissões.</small>
                </div>
                <Switch
                  checked={allowAffiliateEvolution}
                  disabled={!active}
                  onChange={setAllowAffiliateEvolution}
                  label="Permitir evolução de afiliado"
                />
              </div>
            </div>
          </section>

          <section className={styles.block}>
            <div className={styles.blockTitle}>
              <span><ShieldCheck size={17} /></span>
              <div>
                <h3>Carteira de clientes</h3>
                <p>Controle as informações adicionais que diferenciam o Credenciado do Afiliado.</p>
              </div>
            </div>
            <div className={styles.toggleList}>
              <div className={styles.toggleRow}>
                <div>
                  <strong>Liberar carteira de clientes</strong>
                  <small>Permite ao Credenciado acompanhar os clientes atribuídos às suas indicações.</small>
                </div>
                <Switch
                  checked={customerPortfolioAccess}
                  onChange={(value) => {
                    setCustomerPortfolioAccess(value);
                    if (!value) {
                      setCustomerContactAccess(false);
                      setSubscriptionDetailsAccess(false);
                    }
                  }}
                  label="Liberar carteira de clientes"
                />
              </div>
              <div className={styles.toggleRow}>
                <div>
                  <strong>Exibir dados de contato</strong>
                  <small>Permite mostrar nome, e-mail e dados de contato disponíveis na carteira.</small>
                </div>
                <Switch
                  checked={customerContactAccess}
                  disabled={!customerPortfolioAccess}
                  onChange={setCustomerContactAccess}
                  label="Exibir dados de contato"
                />
              </div>
              <div className={styles.toggleRow}>
                <div>
                  <strong>Exibir detalhes do plano e assinatura</strong>
                  <small>Permite mostrar plano contratado, situação da assinatura e composição recorrente do cliente.</small>
                </div>
                <Switch
                  checked={subscriptionDetailsAccess}
                  disabled={!customerPortfolioAccess}
                  onChange={setSubscriptionDetailsAccess}
                  label="Exibir detalhes da assinatura"
                />
              </div>
            </div>
          </section>

          <p className={styles.notice}>
            Comissões continuam seguindo as Ofertas e as Configurações individuais de cada Credenciado. Este modal controla somente regras da categoria.
          </p>
        </div>

        {error && <p className={styles.error} role="alert">{error}</p>}

        <footer className={styles.footer}>
          <span>{active ? "Credenciados habilitados para este produto" : "Categoria será mantida pausada"}</span>
          <div>
            <button type="button" className={styles.secondary} disabled={busy} onClick={() => ref.current?.close()}>
              Cancelar
            </button>
            <button className={styles.primary} disabled={busy}>
              {busy ? "Salvando..." : "Salvar configurações"}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
