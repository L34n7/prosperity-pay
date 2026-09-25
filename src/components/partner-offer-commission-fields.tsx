"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { PackagePlus, SlidersHorizontal, X } from "lucide-react";
import type { AffiliateOfferSettings } from "@/components/product-affiliate-settings-dialog";
import styles from "./partner-offer-commission-fields.module.css";

export type PartnerOfferCommissionOverride = {
  offer_id: string;
  commission_bps: number;
};

export type PartnerAddonCommissionOverride = {
  addon_id: string;
  commission_bps: number;
};

export type PartnerAddonSettings = {
  id: string;
  name: string;
  code: string;
  unit_amount_cents: number;
  active: boolean;
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(cents || 0) / 100);
}

function percentFromInput(value: string) {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function commissionValue(amountCents: number, percentage: number) {
  return Math.round((amountCents * percentage) / 100);
}

export function readPartnerOfferCommissionOverrides(
  data: FormData,
  offers: AffiliateOfferSettings[],
) {
  return offers
    .filter((offer) => offer.affiliate_enabled)
    .map((offer) => {
      const raw = String(data.get(`offerCommission:${offer.id}`) ?? "").trim().replace(",", ".");
      if (!raw) return { offerId: offer.id, commissionBps: null as number | null };
      const percentage = Number(raw);
      if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        throw new Error(`Comissão inválida em "${offer.name}". Use um valor entre 0% e 100%.`);
      }
      return { offerId: offer.id, commissionBps: Math.round(percentage * 100) };
    });
}

export function readPartnerAddonCommissionOverrides(
  data: FormData,
  addons: PartnerAddonSettings[],
) {
  return addons.map((addon) => {
    const raw = String(data.get(`addonCommission:${addon.id}`) ?? "").trim().replace(",", ".");
    if (!raw) return { addonId: addon.id, commissionBps: null as number | null };
    const percentage = Number(raw);
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      throw new Error(`Comissão inválida no adicional "${addon.name}". Use um valor entre 0% e 100%.`);
    }
    return { addonId: addon.id, commissionBps: Math.round(percentage * 100) };
  });
}

function CommissionInput({
  name,
  initialBps,
  fallbackBps,
  amountCents,
  placeholder,
  ariaLabel,
  fallbackDescription,
  suffix,
}: {
  name: string;
  initialBps: number | null;
  fallbackBps: number | null;
  amountCents: number;
  placeholder: string;
  ariaLabel: string;
  fallbackDescription: string;
  suffix?: string;
}) {
  const [value, setValue] = useState(initialBps == null ? "" : String(initialBps / 100));
  const customPercentage = percentFromInput(value);
  const effectivePercentage = customPercentage ?? (fallbackBps == null ? null : fallbackBps / 100);
  const receiveCents = effectivePercentage == null
    ? null
    : commissionValue(amountCents, effectivePercentage);
  const customized = value.trim() !== "";

  return (
    <div className={styles.commissionEditor}>
      <div className={styles.inputWrap}>
        <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          inputMode="decimal"
          name={name}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
        />
        <em>%</em>
      </div>

      <div className={`${styles.receivePreview} ${customized ? styles.receivePreviewCustom : ""}`}>
        {receiveCents == null ? (
          <>
            <span>Comissão</span>
            <strong>{fallbackDescription}</strong>
          </>
        ) : (
          <>
            <span>{customized ? "Parceiro recebe" : "Recebe pelo padrão"}</span>
            <strong>
              {money(receiveCents)}
              {suffix ? <small>{suffix}</small> : null}
            </strong>
          </>
        )}
      </div>
    </div>
  );
}

export function PartnerOfferCommissionFields({
  offers,
  overrides = [],
  addons = [],
  addonOverrides = [],
  commissionAddonsEnabled = false,
}: {
  offers: AffiliateOfferSettings[];
  overrides?: PartnerOfferCommissionOverride[];
  addons?: PartnerAddonSettings[];
  addonOverrides?: PartnerAddonCommissionOverride[];
  commissionAddonsEnabled?: boolean;
}) {
  const enabledOffers = offers.filter((offer) => offer.affiliate_enabled);
  const overrideMap = useMemo(
    () => new Map(overrides.map((item) => [item.offer_id, item.commission_bps])),
    [overrides],
  );
  const addonOverrideMap = useMemo(
    () => new Map(addonOverrides.map((item) => [item.addon_id, item.commission_bps])),
    [addonOverrides],
  );

  return (
    <div className={styles.sections}>
      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <span>Comissões individuais por oferta</span>
            <strong>Personalização opcional</strong>
          </div>
          <small>Em branco = usa automaticamente o percentual padrão configurado na oferta.</small>
        </div>

        {enabledOffers.length ? (
          <div className={styles.offerList}>
            {enabledOffers.map((offer) => {
              const override = overrideMap.get(offer.id) ?? null;
              const standardPercentage = offer.affiliate_commission_bps / 100;
              const standardCommission = commissionValue(offer.price_cents, standardPercentage);

              return (
                <div className={styles.offerRow} key={offer.id}>
                  <div className={styles.offerInfo}>
                    <strong>{offer.name}</strong>
                    <div className={styles.offerMeta}>
                      <span>Valor <b>{money(offer.price_cents)}</b></span>
                      <span>
                        Padrão <b>{standardPercentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</b>
                      </span>
                      <span>Comissão padrão <b>{money(standardCommission)}</b></span>
                    </div>
                  </div>

                  <CommissionInput
                    name={`offerCommission:${offer.id}`}
                    initialBps={override}
                    fallbackBps={offer.affiliate_commission_bps}
                    amountCents={offer.price_cents}
                    placeholder={`Padrão ${standardPercentage.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`}
                    ariaLabel={`Comissão individual para ${offer.name}`}
                    fallbackDescription="Padrão da oferta"
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>
            Nenhuma oferta está habilitada para parceiros. Configure as ofertas antes de criar exceções individuais.
          </div>
        )}

        <p className={styles.hint}>
          Uma comissão personalizada substitui somente esta oferta para este parceiro. As outras continuam seguindo seus próprios percentuais padrão.
        </p>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <span>Comissões em adicionais</span>
            <strong>Adicionais recorrentes</strong>
          </div>
          <small>
            O adicional sem percentual individual herda a comissão efetiva da oferta/plano do cliente.
          </small>
        </div>

        {!commissionAddonsEnabled ? (
          <div className={styles.addonDisabled}>
            <PackagePlus size={17} />
            <div>
              <strong>Comissão de adicionais desabilitada</strong>
              <span>Ative “Comissionar adicionais nas renovações” nas configurações gerais para personalizar adicionais por parceiro.</span>
            </div>
          </div>
        ) : addons.length ? (
          <div className={styles.offerList}>
            {addons.map((addon) => {
              const override = addonOverrideMap.get(addon.id) ?? null;
              return (
                <div className={styles.offerRow} key={addon.id}>
                  <div className={styles.offerInfo}>
                    <strong>
                      {addon.name}
                      {!addon.active ? <small className={styles.inactiveTag}>Inativo</small> : null}
                    </strong>
                    <div className={styles.offerMeta}>
                      <span>Valor <b>{money(addon.unit_amount_cents)}/mês</b></span>
                      <span>Padrão <b>mesma % da oferta/plano</b></span>
                    </div>
                  </div>

                  <CommissionInput
                    name={`addonCommission:${addon.id}`}
                    initialBps={override}
                    fallbackBps={null}
                    amountCents={addon.unit_amount_cents}
                    placeholder="Herdar da oferta"
                    ariaLabel={`Comissão individual para o adicional ${addon.name}`}
                    fallbackDescription="Herda % do plano"
                    suffix="/mês por unidade"
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.empty}>Nenhum adicional recorrente foi cadastrado neste produto.</div>
        )}

        {commissionAddonsEnabled && addons.length > 0 ? (
          <p className={styles.hint}>
            Exemplo: adicional de {money(addons[0].unit_amount_cents)} com comissão individual de 20% gera {money(commissionValue(addons[0].unit_amount_cents, 20))} por unidade na renovação.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function PartnerIndividualCommissionDialog({
  partnerName,
  partnerLabel,
  offers,
  overrides,
  addons = [],
  addonOverrides = [],
  commissionAddonsEnabled = false,
  busy,
  onClose,
  onSave,
}: {
  partnerName: string;
  partnerLabel: "Afiliado" | "Credenciado";
  offers: AffiliateOfferSettings[];
  overrides: PartnerOfferCommissionOverride[];
  addons?: PartnerAddonSettings[];
  addonOverrides?: PartnerAddonCommissionOverride[];
  commissionAddonsEnabled?: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (input: {
    offerCommissionOverrides: Array<{ offerId: string; commissionBps: number | null }>;
    addonCommissionOverrides?: Array<{ addonId: string; commissionBps: number | null }>;
  }) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      const data = new FormData(event.currentTarget);
      const offerCommissionOverrides = readPartnerOfferCommissionOverrides(data, offers);
      const addonCommissionOverrides = commissionAddonsEnabled
        ? readPartnerAddonCommissionOverrides(data, addons)
        : undefined;
      await onSave({ offerCommissionOverrides, addonCommissionOverrides });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar as configurações individuais.");
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
      <form onSubmit={(event) => void submit(event)}>
        <header className={styles.header}>
          <div className={styles.headerIcon}><SlidersHorizontal size={20} /></div>
          <div className={styles.headerText}>
            <span>Configurações individuais</span>
            <h3>{partnerName}</h3>
            <p>
              Personalize somente o que deve ser diferente do padrão para este {partnerLabel.toLowerCase()}.
            </p>
          </div>
          <button
            type="button"
            className={styles.close}
            disabled={busy}
            onClick={() => ref.current?.close()}
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </header>

        <div className={styles.body}>
          <PartnerOfferCommissionFields
            offers={offers}
            overrides={overrides}
            addons={addons}
            addonOverrides={addonOverrides}
            commissionAddonsEnabled={commissionAddonsEnabled}
          />
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>

        <footer className={styles.footer}>
          <p>Sem personalização, alterações futuras nas regras padrão passam a valer automaticamente.</p>
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
