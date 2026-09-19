type RawObject = Record<string, unknown>;

export type MercadoPagoPaymentMethod = "card" | "pix" | "other";

export type MercadoPagoPaymentMetadata = {
  method: MercadoPagoPaymentMethod;
  method_id: string | null;
  payment_type_id: string | null;
  status_detail: string | null;
  installments: number | null;
  card_last_four: string | null;
  provider_created_at: string | null;
  provider_approved_at: string | null;
};

function asObject(value: unknown): RawObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RawObject : null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function firstPayment(root: RawObject | null) {
  if (!root) return null;
  const transactions = asObject(root.transactions);
  const payments = transactions?.payments;
  if (!Array.isArray(payments)) return null;
  return asObject(payments[0]);
}

export function mercadoPagoPaymentMetadata(raw: unknown): MercadoPagoPaymentMetadata {
  const root = asObject(raw);
  const orderPayment = firstPayment(root);
  const nestedPayment = root ? asObject(root.payment) : null;
  const data = orderPayment ?? nestedPayment ?? root;
  const paymentMethod = data ? asObject(data.payment_method) : null;
  const card = (data ? asObject(data.card) : null) ?? (paymentMethod ? asObject(paymentMethod.card) : null);

  const methodId = text(data?.payment_method_id) ?? text(paymentMethod?.id);
  const typeId = text(data?.payment_type_id) ?? text(paymentMethod?.type);
  const normalizedMethod = methodId?.toLowerCase() ?? "";
  const normalizedType = typeId?.toLowerCase() ?? "";

  let method: MercadoPagoPaymentMethod = "other";
  if (normalizedMethod === "pix" || normalizedType === "bank_transfer" || normalizedType === "pix") {
    method = "pix";
  } else if (normalizedType.includes("card") || normalizedMethod.includes("visa") || normalizedMethod.includes("master") || Boolean(card)) {
    method = "card";
  }

  return {
    method,
    method_id: methodId,
    payment_type_id: typeId,
    status_detail: text(data?.status_detail) ?? text(root?.status_detail),
    installments: number(data?.installments) ?? number(paymentMethod?.installments),
    card_last_four: text(card?.last_four_digits) ?? text(paymentMethod?.last_four_digits),
    provider_created_at: text(data?.date_created) ?? text(root?.created_date) ?? text(root?.date_created),
    provider_approved_at: text(data?.date_approved) ?? text(root?.date_approved),
  };
}
