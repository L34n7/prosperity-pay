export function isHiddenTestPayment(rawProviderData: unknown) {
  if (!rawProviderData || typeof rawProviderData !== "object" || Array.isArray(rawProviderData)) {
    return false;
  }

  return (rawProviderData as Record<string, unknown>).prosperity_hidden_test === true;
}
