const LEGACY_REFERENCE_PATTERN = /-([a-f0-9]{8})$/i;

export const PROSPERITY_PAY_ORIGIN = "https://www.prosperitypay.com.br";

export function checkoutReference(checkoutSlug: string) {
  const legacy = checkoutSlug.match(LEGACY_REFERENCE_PATTERN);
  return (legacy?.[1] ?? checkoutSlug).toLowerCase();
}

export function checkoutPath(checkoutSlug: string) {
  return `/checkout/${checkoutReference(checkoutSlug)}`;
}

export function checkoutUrl(checkoutSlug: string, refCode?: string) {
  const base = `${PROSPERITY_PAY_ORIGIN}${checkoutPath(checkoutSlug)}`;
  return refCode ? `${base}?ref=${encodeURIComponent(refCode)}` : base;
}

export function createCheckoutReference() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 12).toLowerCase();
}
