"use client";

import { useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import type { AffiliateOfferSettings } from "@/components/product-affiliate-settings-dialog";
import { checkoutUrl } from "@/lib/domain/offer-reference";
import styles from "./product-partner-management.module.css";

export function PartnerCheckoutLinks({
  partnerCode,
  offers,
  partnerLabel,
}: {
  partnerCode: string;
  offers: AffiliateOfferSettings[];
  partnerLabel: "Afiliado" | "Credenciado";
}) {
  const [copiedOfferId, setCopiedOfferId] = useState("");
  const enabledOffers = offers.filter((offer) => offer.affiliate_enabled);

  async function copyLink(offerId: string, url: string) {
    await navigator.clipboard.writeText(url);
    setCopiedOfferId(offerId);
    window.setTimeout(() => setCopiedOfferId(""), 1400);
  }

  return (
    <div className={styles.partnerLinksPanel}>
      <div className={styles.partnerLinksHeader}>
        <div>
          <span><Link2 size={15} /></span>
          <div>
            <strong>Links de checkout do {partnerLabel.toLowerCase()}</strong>
            <small>Somente ofertas com afiliação habilitada são exibidas.</small>
          </div>
        </div>
      </div>

      {enabledOffers.length ? (
        <div className={styles.partnerLinksList}>
          {enabledOffers.map((offer) => {
            const url = checkoutUrl(offer.checkout_slug, partnerCode);
            return (
              <div className={styles.partnerLinkRow} key={offer.id}>
                <div className={styles.partnerLinkOffer}>
                  <strong>{offer.name}</strong>
                  <small>{offer.status === "active" ? "Checkout ativo" : "Checkout inativo"}</small>
                </div>
                <code className={styles.partnerLinkUrl} title={url}>{url}</code>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => void copyLink(offer.id, url)}
                >
                  {copiedOfferId === offer.id ? <Check size={14} /> : <Copy size={14} />}
                  {copiedOfferId === offer.id ? "Copiado" : "Copiar link"}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.partnerLinksEmpty}>
          Nenhum checkout deste produto está com afiliação habilitada.
        </div>
      )}
    </div>
  );
}
