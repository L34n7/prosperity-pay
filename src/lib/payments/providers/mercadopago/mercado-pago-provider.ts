import { env, requireEnv } from "@/lib/env";
import type { PaymentProvider } from "../../payment-provider";
import type {
  CreateCheckoutInput,
  CreatePaymentInput,
  PaymentStatus,
  ProviderCheckout,
  ProviderPayment,
  RefundPaymentInput,
} from "../../types";

const API_URL = "https://api.mercadopago.com";

type MercadoPagoPaymentResponse = {
  id?: number;
  status?: string;
  external_reference?: string | null;
  transaction_amount?: number;
  currency_id?: string;
  point_of_interaction?: {
    transaction_data?: {
      ticket_url?: string;
    };
  };
  init_point?: string;
  sandbox_init_point?: string;
};

type MercadoPagoPreferenceResponse = {
  id?: string;
  init_point?: string;
  sandbox_init_point?: string;
};

function mapStatus(status?: string): PaymentStatus {
  switch (status) {
    case "approved":
      return "approved";
    case "rejected":
      return "rejected";
    case "cancelled":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "charged_back":
      return "charged_back";
    case "in_process":
    case "in_mediation":
      return "processing";
    default:
      return "pending";
  }
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

    if (!body.id || !body.init_point) {
      throw new Error("Mercado Pago retornou preferencia incompleta.");
    }
    return {
      provider: "mercadopago",
      externalId: body.id,
      checkoutUrl: body.init_point,
      sandboxCheckoutUrl: body.sandbox_init_point,
    };
  }

  private async request<T>(
    path: string,
    init?: RequestInit,
    idempotencyKey?: string,
  ): Promise<T> {
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

    if (!response.ok) {
      const message = body?.message || `Mercado Pago respondeu HTTP ${response.status}`;
      throw new Error(message);
    }

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
          payer: input.payer
            ? {
                email: input.payer.email,
                identification: input.payer.document
                  ? { number: input.payer.document }
                  : undefined,
              }
            : undefined,
          metadata: input.metadata,
        }),
      },
      input.idempotencyKey,
    );

    return this.normalize(body);
  }

  async getPayment(externalPaymentId: string): Promise<ProviderPayment> {
    const body = await this.request<MercadoPagoPaymentResponse>(
      `/v1/payments/${encodeURIComponent(externalPaymentId)}`,
    );

    return this.normalize(body);
  }

  async refundPayment(input: RefundPaymentInput): Promise<ProviderPayment> {
    await this.request(
      `/v1/payments/${encodeURIComponent(input.externalPaymentId)}/refunds`,
      {
        method: "POST",
        body: JSON.stringify(input.amount ? { amount: input.amount } : {}),
      },
      input.idempotencyKey,
    );

    return this.getPayment(input.externalPaymentId);
  }

  private normalize(body: MercadoPagoPaymentResponse): ProviderPayment {
    if (!body.id) {
      throw new Error("Mercado Pago retornou pagamento sem identificador.");
    }

    return {
      provider: "mercadopago",
      externalId: String(body.id),
      externalReference: body.external_reference || undefined,
      status: mapStatus(body.status),
      checkoutUrl:
        body.point_of_interaction?.transaction_data?.ticket_url ||
        body.init_point ||
        body.sandbox_init_point,
      money: {
        amount: body.transaction_amount || 0,
        currency: "BRL",
      },
      raw: body,
    };
  }
}
