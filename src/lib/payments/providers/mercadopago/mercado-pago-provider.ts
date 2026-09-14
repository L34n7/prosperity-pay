import { env, requireEnv } from "@/lib/env";
import type { PaymentProvider } from "../../payment-provider";
import type {
  CreateCheckoutInput,
  CreatePaymentInput,
  CreateSubscriptionInput,
  PaymentStatus,
  ProviderAuthorizedPayment,
  ProviderCheckout,
  ProviderPayment,
  ProviderSubscription,
  ProviderSubscriptionStatus,
  RefundPaymentInput,
} from "../../types";

const API_URL = "https://api.mercadopago.com";

type MercadoPagoPaymentResponse = {
  id?: number;
  status?: string;
  external_reference?: string | null;
  transaction_amount?: number;
  currency_id?: string;
  point_of_interaction?: { transaction_data?: { ticket_url?: string } };
  init_point?: string;
  sandbox_init_point?: string;
};

type MercadoPagoPreferenceResponse = {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
};

type MercadoPagoSubscriptionResponse = {
  id?: string;
  external_reference?: string | null;
  status?: string;
  init_point?: string;
  next_payment_date?: string;
  auto_recurring?: {
    transaction_amount?: number | string;
    currency_id?: string;
  };
};

type MercadoPagoAuthorizedPaymentResponse = {
  id?: number | string;
  preapproval_id?: string;
  external_reference?: string | null;
  transaction_amount?: number;
  debit_date?: string;
  payment?: {
    id?: number | string;
    status?: string;
    status_detail?: string;
  };
};

function mapStatus(status?: string): PaymentStatus {
  switch (status) {
    case "approved": return "approved";
    case "rejected": return "rejected";
    case "cancelled": return "cancelled";
    case "refunded": return "refunded";
    case "charged_back": return "charged_back";
    case "in_process":
    case "in_mediation": return "processing";
    default: return "pending";
  }
}

function mapSubscriptionStatus(status?: string): ProviderSubscriptionStatus {
  switch (status) {
    case "authorized": return "authorized";
    case "paused": return "paused";
    case "cancelled":
    case "canceled": return "cancelled";
    default: return "pending";
  }
}

function checkoutPaymentMethods(input: CreateCheckoutInput) {
  const excludedPaymentTypes: { id: string }[] = [];
  if (input.paymentMethods) {
    // The product only exposes card and PIX. Mercado Pago account balance is a provider-controlled exception.
    excludedPaymentTypes.push({ id: "ticket" }, { id: "atm" }, { id: "debit_card" }, { id: "prepaid_card" }, { id: "digital_currency" });
    if (!input.paymentMethods.card) excludedPaymentTypes.push({ id: "credit_card" });
    if (!input.paymentMethods.pix) excludedPaymentTypes.push({ id: "bank_transfer" });
  }
  if (!input.maxInstallments && !excludedPaymentTypes.length) return undefined;
  return {
    installments: input.maxInstallments,
    excluded_payment_types: excludedPaymentTypes.length ? excludedPaymentTypes : undefined,
  };
}

export class MercadoPagoProvider implements PaymentProvider {
  constructor(private readonly token?: string) {}

  private get accessToken() {
    return this.token || requireEnv(env.mercadoPagoAccessToken, "MERCADO_PAGO_ACCESS_TOKEN");
  }

  async createCheckout(input: CreateCheckoutInput): Promise<ProviderCheckout> {
    const body = await this.request<MercadoPagoPreferenceResponse>(
      "/checkout/preferences",
      {
        method: "POST",
        body: JSON.stringify({
          external_reference: input.externalReference,
          items: [{
            id: input.externalReference,
            title: input.title,
            currency_id: input.money.currency,
            quantity: input.quantity ?? 1,
            unit_price: input.money.amount,
          }],
          payer: input.payerEmail ? { email: input.payerEmail } : undefined,
          marketplace_fee: input.marketplaceFeeAmount,
          payment_methods: checkoutPaymentMethods(input),
          notification_url: input.notificationUrl,
          back_urls: {
            success: input.successUrl,
            failure: input.failureUrl,
            pending: input.pendingUrl,
          },
          auto_return: "approved",
          date_of_expiration: input.expiresAt?.toISOString(),
        }),
      },
      input.idempotencyKey,
    );

    if (!body.id || !body.init_point) throw new Error("Mercado Pago retornou preferencia incompleta.");
    return {
      provider: "mercadopago",
      externalId: body.id,
      checkoutUrl: body.init_point,
      sandboxCheckoutUrl: body.sandbox_init_point,
    };
  }

  async createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription> {
    const body = await this.request<MercadoPagoSubscriptionResponse>(
      "/preapproval",
      {
        method: "POST",
        body: JSON.stringify({
          reason: input.reason,
          external_reference: input.externalReference,
          payer_email: input.payerEmail,
          auto_recurring: {
            frequency: input.frequency,
            frequency_type: input.frequencyType,
            transaction_amount: input.money.amount,
            currency_id: input.money.currency,
          },
          back_url: input.backUrl,
          status: "pending",
        }),
      },
      input.idempotencyKey,
    );
    return this.normalizeSubscription(body);
  }

  async getSubscription(externalSubscriptionId: string): Promise<ProviderSubscription> {
    return this.normalizeSubscription(await this.request<MercadoPagoSubscriptionResponse>(`/preapproval/${encodeURIComponent(externalSubscriptionId)}`));
  }

  async updateSubscriptionAmount(externalSubscriptionId: string, amount: number, currency: "BRL" = "BRL"): Promise<ProviderSubscription> {
    const body = await this.request<MercadoPagoSubscriptionResponse>(
      `/preapproval/${encodeURIComponent(externalSubscriptionId)}`,
      {
        method: "PUT",
        body: JSON.stringify({ auto_recurring: { transaction_amount: amount, currency_id: currency } }),
      },
    );
    return this.normalizeSubscription(body);
  }

  async getAuthorizedPayment(externalAuthorizedPaymentId: string): Promise<ProviderAuthorizedPayment> {
    const body = await this.request<MercadoPagoAuthorizedPaymentResponse>(`/authorized_payments/${encodeURIComponent(externalAuthorizedPaymentId)}`);
    if (!body.id || !body.preapproval_id) throw new Error("Mercado Pago retornou fatura recorrente incompleta.");
    return {
      provider: "mercadopago",
      externalId: String(body.id),
      subscriptionExternalId: body.preapproval_id,
      externalReference: body.external_reference || undefined,
      paymentExternalId: body.payment?.id ? String(body.payment.id) : undefined,
      paymentStatus: body.payment?.status ? mapStatus(body.payment.status) : undefined,
      money: { amount: Number(body.transaction_amount ?? 0), currency: "BRL" },
      debitDate: body.debit_date,
      raw: body,
    };
  }

  private async request<T>(path: string, init?: RequestInit, idempotencyKey?: string): Promise<T> {
    const response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "X-Idempotency-Key": idempotencyKey } : {}),
        ...init?.headers,
      },
      cache: "no-store",
    });
    const body = (await response.json()) as T & { message?: string };
    if (!response.ok) throw new Error(body?.message || `Mercado Pago respondeu HTTP ${response.status}`);
    return body;
  }

  async createPayment(input: CreatePaymentInput): Promise<ProviderPayment> {
    const body = await this.request<MercadoPagoPaymentResponse>(
      "/v1/payments",
      {
        method: "POST",
        body: JSON.stringify({
          transaction_amount: input.money.amount,
          description: input.description,
          external_reference: input.externalReference,
          notification_url: input.notificationUrl,
          payer: input.payer ? { email: input.payer.email, identification: input.payer.document ? { number: input.payer.document } : undefined } : undefined,
          metadata: input.metadata,
        }),
      },
      input.idempotencyKey,
    );
    return this.normalize(body);
  }

  async getPayment(externalPaymentId: string): Promise<ProviderPayment> {
    return this.normalize(await this.request<MercadoPagoPaymentResponse>(`/v1/payments/${encodeURIComponent(externalPaymentId)}`));
  }

  async refundPayment(input: RefundPaymentInput): Promise<ProviderPayment> {
    await this.request(`/v1/payments/${encodeURIComponent(input.externalPaymentId)}/refunds`, {
      method: "POST",
      body: JSON.stringify(input.amount ? { amount: input.amount } : {}),
    }, input.idempotencyKey);
    return this.getPayment(input.externalPaymentId);
  }

  private normalizeSubscription(body: MercadoPagoSubscriptionResponse): ProviderSubscription {
    if (!body.id) throw new Error("Mercado Pago retornou assinatura sem identificador.");
    const amount = body.auto_recurring?.transaction_amount;
    return {
      provider: "mercadopago",
      externalId: body.id,
      externalReference: body.external_reference || undefined,
      status: mapSubscriptionStatus(body.status),
      checkoutUrl: body.init_point,
      nextPaymentDate: body.next_payment_date,
      money: amount == null ? undefined : { amount: Number(amount), currency: "BRL" },
      raw: body,
    };
  }

  private normalize(body: MercadoPagoPaymentResponse): ProviderPayment {
    if (!body.id) throw new Error("Mercado Pago retornou pagamento sem identificador.");
    return {
      provider: "mercadopago",
      externalId: String(body.id),
      externalReference: body.external_reference || undefined,
      status: mapStatus(body.status),
      checkoutUrl: body.point_of_interaction?.transaction_data?.ticket_url || body.init_point || body.sandbox_init_point,
      money: { amount: body.transaction_amount || 0, currency: "BRL" },
      raw: body,
    };
  }
}
