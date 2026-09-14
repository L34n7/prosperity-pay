export type PaymentProviderCode = "mercadopago";

export type PaymentStatus =
  | "pending"
  | "processing"
  | "approved"
  | "rejected"
  | "cancelled"
  | "refunded"
  | "charged_back";

export type Money = {
  amount: number;
  currency: "BRL";
};

export type Payer = {
  name?: string;
  email?: string;
  document?: string;
};

export type CreatePaymentInput = {
  externalReference: string;
  description: string;
  money: Money;
  payer?: Payer;
  idempotencyKey: string;
  notificationUrl?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

export type ProviderPayment = {
  provider: PaymentProviderCode;
  externalId: string;
  externalReference?: string;
  status: PaymentStatus;
  checkoutUrl?: string;
  money: Money;
  raw?: unknown;
};

export type RefundPaymentInput = {
  externalPaymentId: string;
  amount?: number;
  idempotencyKey: string;
};

export type CreateCheckoutInput = {
  externalReference: string;
  idempotencyKey: string;
  title: string;
  quantity?: number;
  money: Money;
  payerEmail?: string;
  notificationUrl: string;
  successUrl: string;
  failureUrl: string;
  pendingUrl: string;
  marketplaceFeeAmount?: number;
  maxInstallments?: number;
  paymentMethods?: {
    card: boolean;
    pix: boolean;
    primary: "card" | "pix";
  };
  expiresAt?: Date;
};

export type ProviderCheckout = {
  provider: PaymentProviderCode;
  externalId: string;
  checkoutUrl: string;
  sandboxCheckoutUrl?: string;
};
