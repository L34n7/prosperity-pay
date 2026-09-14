export const AFFILIATE_HOLD_DAYS = 7;
export const MIN_INSTALLMENT_AMOUNT_CENTS = 5_000;
export const MAX_INSTALLMENTS = 12;

export function calculateMaxInstallments(priceCents: number) {
  if (!Number.isFinite(priceCents) || priceCents <= 0) return 1;
  return Math.max(
    1,
    Math.min(MAX_INSTALLMENTS, Math.floor(priceCents / MIN_INSTALLMENT_AMOUNT_CENTS)),
  );
}

export function getInstallmentOptions(priceCents: number) {
  return Array.from({ length: calculateMaxInstallments(priceCents) }, (_, index) => index + 1);
}
