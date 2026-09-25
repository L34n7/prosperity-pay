"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import type { AffiliateOfferSettings } from "@/components/product-affiliate-settings-dialog";
import styles from "./partner-offer-commission-fields.module.css";

export type PartnerOfferCommissionOverride = {
  offer_id: string;
  commission_bps: number;
};

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

export function PartnerOfferCommissionFields({
  offers,
  overrides = [],
}: {
  offers: AffiliateOfferSettings[];
  overrides?: PartnerOfferCommissionOverride[];
}) {
  const enabledOffers = offers.filter((offer) => offer.affiliate_enabled);
  const overrideMap = new Map(overrides.map((item) => [item.offer_id, item.commission_bps]));

  if (!enabledOffers.length) {
    return (
      <div className={styles.empty}>
        Nenhuma oferta está habilitada para parceiros. Configure as ofertas antes de criar exceções individuais.
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <span>Comissões individuais por oferta</span>
          <strong>Personalização opcional</strong>
        </div>
        <small>Em branco = usa automaticamente o percentual padrão da oferta.</small>
      </div>

      <div className={styles.offerList}>
        {enabledOffers.map((offer) => {
          const override = overrideMap.get(offer.id);
          const standard = offer.affiliate_commission_bps / 100;
          return (
            <label className={styles.offerRow} key={offer.id}>
              <div className={styles.offerInfo}>
                <strong>{offer.name}</strong>
                <span>
                  Padrão da oferta:{" "}
                  <b>{standard.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%</b>
                </span>
              </div>
              <div className={styles.inputWrap}>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  inputMode="decimal"
                  name={`offerCommission:${offer.id}`}
                  defaultValue={override == null ? "" : String(override / 100)}
                  placeholder={`Padrão ${standard.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`}
                  aria-label={`Comissão individual para ${offer.name}`}
                />
                <em>%</em>
              </div>
            </label>
          );
        })}
      </div>

      <p className={styles.hint}>
        Uma comissão personalizada substitui somente esta oferta para este parceiro. As outras continuam seguindo seus próprios percentuais padrão.
      </p>
    </div>
  );
}

export function PartnerIndividualCommissionDialog({
  partnerName,
  partnerLabel,
  offers,
  overrides,
  busy,
  onClose,
  onSave,
}: {
  partnerName: string;
  partnerLabel: "Afiliado" | "Credenciado";
  offers: AffiliateOfferSettings[];
  overrides: PartnerOfferCommissionOverride[];
  busy: boolean;
  onClose: () => void;
  onSave: (overrides: Array<{ offerId: string; commissionBps: number | null }>) => Promise<void>;
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
      const values = readPartnerOfferCommissionOverrides(new FormData(event.currentTarget), offers);
      await onSave(values);
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
              Personalize apenas o que deve ser diferente do padrão das ofertas para este {partnerLabel.toLowerCase()}.
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
          <PartnerOfferCommissionFields offers={offers} overrides={overrides} />
          {error && <p className={styles.error} role="alert">{error}</p>}
        </div>

        <footer className={styles.footer}>
          <p>Sem personalização, alterações futuras na comissão padrão da oferta passam a valer automaticamente.</p>
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
