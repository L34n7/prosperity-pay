import { getProviderAccessToken } from "@/lib/payments/provider-credentials";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

type MpFeeDetail = {
  amount?: number | string;
  fee_payer?: string;
  type?: string;
};

type MpChargeDetail = {
  amounts?: { original?: number | string };
  name?: string;
  type?: string;
};

type MpSearchPayment = {
  id?: number | string;
  status?: string;
  external_reference?: string | null;
  fee_details?: MpFeeDetail[];
  charges_details?: MpChargeDetail[];
};

type MpPaymentSearchResponse = {
  results?: MpSearchPayment[];
};

export type FeeReconciliationPayment = {
  id: string;
  order_id: string;
  connection_id: string | null;
  status: string;
  external_payment_id: string | null;
  provider_fee_amount_cents: number;
  raw_provider_data: unknown;
};

function asObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return 0;
}

function manualPayment(payment: Pick<FeeReconciliationPayment, "external_payment_id" | "raw_provider_data">) {
  const raw = asObject(payment.raw_provider_data);
  const source = typeof raw.source === "string" ? raw.source : "";
  return (
    String(payment.external_payment_id || "").startsWith("manual-") ||
    source.startsWith("manual_") ||
    raw.paid_outside_platform === true
  );
}

function alreadyChecked(raw: unknown) {
  const root = asObject(raw);
  return Boolean(asObject(root.prosperity_ml_fee_reconciliation).checked_at);
}

function feeCentsFromPayment(payment: MpSearchPayment) {
  const explicitFees = (payment.fee_details ?? [])
    .filter((item) => !item.fee_payer || item.fee_payer === "collector")
    .reduce((sum, item) => sum + Math.abs(numberValue(item.amount)), 0);

  if (explicitFees > 0) return Math.round(explicitFees * 100);

  const chargeFees = (payment.charges_details ?? [])
    .filter(
      (item) =>
        item.type === "fee" ||
        item.name === "mercadopago_fee" ||
        item.name === "financing_fee",
    )
    .reduce(
      (sum, item) => sum + Math.abs(numberValue(item.amounts?.original)),
      0,
    );

  return Math.round(chargeFees * 100);
}

async function searchMercadoPagoPayment(params: {
  connectionId: string;
  orderId: string;
}) {
  const token = await getProviderAccessToken(params.connectionId);
  const externalReference = `prosperity-${params.orderId}`;
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(
      externalReference,
    )}&sort=date_created&criteria=desc`,
    {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(
      `Mercado Pago respondeu HTTP ${response.status} ao conciliar taxa ML.`,
    );
  }

  const body = (await response.json()) as MpPaymentSearchResponse;
  const payment = (body.results ?? []).find(
    (item) =>
      item.external_reference === externalReference &&
      item.status === "approved",
  );

  return payment ?? null;
}

function mergeReconciliationRaw(raw: unknown, input: {
  checkedAt: string;
  feeCents: number;
  providerPaymentId?: string | number;
}) {
  return {
    ...asObject(raw),
    prosperity_ml_fee_reconciliation: {
      checked_at: input.checkedAt,
      source: "mercadopago_payments_search",
      fee_cents: input.feeCents,
      provider_payment_id:
        input.providerPaymentId == null ? null : String(input.providerPaymentId),
    },
  };
}

export async function reconcileMercadoPagoPaymentFee(params: {
  admin: AdminClient;
  payment: FeeReconciliationPayment;
  force?: boolean;
}) {
  const { admin, payment } = params;

  if (payment.status !== "approved") return null;
  if (manualPayment(payment)) return 0;
  if (!payment.connection_id) return null;
  if (!params.force && Number(payment.provider_fee_amount_cents ?? 0) > 0) {
    return Number(payment.provider_fee_amount_cents);
  }
  if (!params.force && alreadyChecked(payment.raw_provider_data)) {
    return Number(payment.provider_fee_amount_cents ?? 0);
  }

  const providerPayment = await searchMercadoPagoPayment({
    connectionId: payment.connection_id,
    orderId: payment.order_id,
  });

  if (!providerPayment) return null;

  const feeCents = feeCentsFromPayment(providerPayment);
  const checkedAt = new Date().toISOString();
  const mergedRaw = mergeReconciliationRaw(payment.raw_provider_data, {
    checkedAt,
    feeCents,
    providerPaymentId: providerPayment.id,
  });

  const { error: updateError } = await admin
    .from("payments")
    .update({
      provider_fee_amount_cents: feeCents,
      raw_provider_data: mergedRaw as never,
      updated_at: checkedAt,
    })
    .eq("id", payment.id);

  if (updateError) throw updateError;

  // Se o modelo usar saldo Prosperity, uma segunda passagem do lançamento
  // cria apenas a taxa de gateway que ainda não existia; os demais lançamentos
  // são idempotentes por source_id/reference.
  if (feeCents > 0) {
    const { error: postingError } = await admin.rpc("post_payment_financials", {
      target_payment_id: payment.id,
    });
    if (postingError) {
      console.error("[ML FEE] Falha ao reconciliar lançamento financeiro", {
        paymentId: payment.id,
        error: postingError.message,
      });
    }
  }

  return feeCents;
}

export async function reconcileMercadoPagoFees(params: {
  admin: AdminClient;
  payments: FeeReconciliationPayment[];
  limit?: number;
  force?: boolean;
}) {
  const candidates = params.payments
    .filter(
      (payment) =>
        payment.status === "approved" &&
        !manualPayment(payment) &&
        Boolean(payment.connection_id) &&
        (params.force ||
          (Number(payment.provider_fee_amount_cents ?? 0) === 0 &&
            !alreadyChecked(payment.raw_provider_data))),
    )
    .slice(0, Math.max(1, params.limit ?? 25));

  const reconciled = new Map<string, number>();

  for (let index = 0; index < candidates.length; index += 4) {
    const batch = candidates.slice(index, index + 4);
    const results = await Promise.allSettled(
      batch.map((payment) =>
        reconcileMercadoPagoPaymentFee({
          admin: params.admin,
          payment,
          force: params.force,
        }),
      ),
    );

    results.forEach((result, resultIndex) => {
      if (result.status === "fulfilled" && result.value != null) {
        reconciled.set(batch[resultIndex].id, result.value);
      } else if (result.status === "rejected") {
        console.error("[ML FEE] Falha na reconciliação", {
          paymentId: batch[resultIndex].id,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    });
  }

  return reconciled;
}
