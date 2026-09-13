import { NextResponse } from "next/server";
import { env, requireEnv } from "@/lib/env";
import { getPaymentProvider } from "@/lib/payments";
import { getProviderAccessToken } from "@/lib/payments/provider-credentials";
import { verifyMercadoPagoSignature } from "@/lib/payments/providers/mercadopago/webhook-signature";
import { sha256 } from "@/lib/security/hash";
import { createAdminClient } from "@/lib/supabase/admin";

type Payload = {
  id?: string | number;
  type?: string;
  action?: string;
  user_id?: string | number;
  data?: { id?: string | number };
};

type RawPayment = {
  status_detail?: string;
  date_approved?: string;
  fee_details?: Array<{ amount?: number }>;
};

export async function POST(request: Request) {
  const rawBody = await request.text();
  let payload: Payload;
  try { payload = JSON.parse(rawBody) as Payload; } catch { return NextResponse.json({ error: "JSON invalido." }, { status: 400 }); }
  const dataId = String(payload.data?.id ?? new URL(request.url).searchParams.get("data.id") ?? "");
  if (payload.type !== "payment" || !dataId) return NextResponse.json({ received: true, ignored: true });

  const signature = request.headers.get("x-signature") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  const secret = requireEnv(env.mercadoPagoWebhookSecret, "MERCADO_PAGO_WEBHOOK_SECRET");
  if (!verifyMercadoPagoSignature({ signature, requestId, dataId, secret })) {
    return NextResponse.json({ error: "Assinatura invalida." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: provider } = await admin.from("payment_providers").select("id").eq("code", "mercadopago").single();
  if (!provider) return NextResponse.json({ error: "Provedor indisponivel." }, { status: 503 });

  let { data: event, error: eventError } = await admin.from("webhook_events").insert({
    provider_id: provider.id,
    external_event_id: payload.id ? String(payload.id) : requestId,
    external_resource_id: dataId,
    event_type: payload.action ?? payload.type,
    payload_hash: sha256(rawBody),
    payload,
    status: "processing",
    attempts: 1,
  }).select("id").single();
  if (eventError?.code === "23505") {
    const { data: matchingId } = await admin.from("webhook_events").select("id,status,attempts")
      .eq("provider_id", provider.id).eq("external_event_id", payload.id ? String(payload.id) : requestId).maybeSingle();
    const { data: matchingHash } = matchingId ? { data: null } : await admin.from("webhook_events").select("id,status,attempts")
      .eq("provider_id", provider.id).eq("payload_hash", sha256(rawBody)).maybeSingle();
    const existing = matchingId ?? matchingHash;
    if (!existing) return NextResponse.json({ error: "Não foi possível recuperar o evento." }, { status: 503 });
    if (existing.status === "processed") return NextResponse.json({ received: true, duplicate: true });
    if (existing.status === "processing") return NextResponse.json({ error: "Evento em processamento." }, { status: 503 });
    const retry = await admin.from("webhook_events").update({ status: "processing", attempts: existing.attempts + 1, error_message: null })
      .eq("id", existing.id).eq("status", "failed").select("id").maybeSingle();
    if (!retry.data) return NextResponse.json({ error: "Evento em processamento." }, { status: 503 });
    event = { id: retry.data.id } as typeof event;
    eventError = null;
  }
  if (eventError || !event) return NextResponse.json({ error: "Falha ao registrar evento." }, { status: 500 });

  try {
    let connectionQuery = admin.from("payment_provider_connections").select("id")
      .eq("provider_id", provider.id).eq("status", "active");
    if (payload.user_id) connectionQuery = connectionQuery.eq("external_account_id", String(payload.user_id));
    const { data: candidates } = await connectionQuery.limit(payload.user_id ? 1 : 100);
    let connection: { id: string } | undefined;
    let payment: Awaited<ReturnType<ReturnType<typeof getPaymentProvider>["getPayment"]>> | undefined;
    for (const candidate of candidates ?? []) {
      try {
        const fetched = await getPaymentProvider("mercadopago", await getProviderAccessToken(candidate.id)).getPayment(dataId);
        if (!fetched.externalReference) continue;
        const { data: match } = await admin.from("payments").select("id").eq("connection_id", candidate.id).eq("external_reference", fetched.externalReference).maybeSingle();
        if (match) { connection = candidate; payment = fetched; break; }
      } catch { /* Outra conta não é proprietária deste pagamento. */ }
    }
    if (!connection || !payment?.externalReference) throw new Error("Conexão do pagamento não identificada.");
    const raw = (payment.raw ?? {}) as RawPayment;
    const providerFeeCents = Math.round((raw.fee_details ?? []).reduce((sum, item) => sum + (item.amount ?? 0), 0) * 100);
    const { data: originalPayment, error: originalError } = await admin.from("payments").select("id,order_id,gross_amount_cents,currency,connection_id")
      .eq("external_reference", payment.externalReference).eq("connection_id", connection.id).single();
    if (originalError || !originalPayment) throw originalError ?? new Error("Pagamento não pertence a esta conexão.");
    if (Number(originalPayment.gross_amount_cents) !== Math.round(payment.money.amount * 100) || originalPayment.currency !== payment.money.currency) {
      throw new Error("Valor ou moeda do pagamento divergente do pedido.");
    }
    const { data: storedPayment, error: paymentError } = await admin.from("payments").update({
      external_payment_id: payment.externalId,
      status: payment.status,
      status_detail: raw.status_detail,
      provider_fee_amount_cents: providerFeeCents,
      paid_at: payment.status === "approved" ? raw.date_approved ?? new Date().toISOString() : undefined,
      refunded_at: payment.status === "refunded" ? new Date().toISOString() : undefined,
      raw_provider_data: payment.raw as never,
    }).eq("id", originalPayment.id).select("id, order_id, status").single();
    if (paymentError || !storedPayment) throw paymentError ?? new Error("Pagamento interno nao encontrado.");

    await admin.from("payment_transactions").insert({
      payment_id: storedPayment.id,
      provider_event_id: event.id,
      transaction_type: payload.action ?? "payment.updated",
      amount_cents: Math.round(payment.money.amount * 100),
      status: payment.status,
      raw_payload: payment.raw as never,
      occurred_at: new Date().toISOString(),
    });

    if (payment.status === "approved") {
      await admin.from("orders").update({ status: "paid", paid_at: raw.date_approved ?? new Date().toISOString() }).eq("id", storedPayment.order_id);
      const { error } = await admin.rpc("post_payment_financials", { target_payment_id: storedPayment.id });
      if (error) throw error;
    } else if (payment.status === "refunded" || payment.status === "charged_back") {
      const { data: entries, error } = await admin.from("ledger_entries").select("*")
        .eq("payment_id", storedPayment.id).eq("status", "posted").gt("amount_cents", 0);
      if (error) throw error;
      if (entries?.length) {
        const entryType = payment.status === "refunded" ? "refund" : "chargeback";
        const byAccount = new Map<string, { amount: number; ids: string[]; entry: (typeof entries)[number] }>();
        for (const entry of entries) {
          const group = byAccount.get(entry.account_id) ?? { amount: 0, ids: [], entry };
          group.amount += Number(entry.amount_cents);
          group.ids.push(entry.id);
          byAccount.set(entry.account_id, group);
        }
        const reversal = await admin.from("ledger_entries").upsert([...byAccount.values()].map(({ amount, ids, entry }) => ({
          account_id: entry.account_id, order_id: entry.order_id, payment_id: entry.payment_id,
          settlement_model: entry.settlement_model, entry_type: entryType,
          amount_cents: -amount, currency: entry.currency, available_at: new Date().toISOString(),
          source_type: entryType, source_id: storedPayment.id, reference: `${entryType}:${payment.externalId}`,
          metadata: { reversesEntryIds: ids },
        })), { onConflict: "account_id,source_type,source_id,entry_type", ignoreDuplicates: true });
        if (reversal.error) throw reversal.error;
      }
      await Promise.all([
        admin.from("orders").update({ status: payment.status === "refunded" ? "refunded" : "charged_back" }).eq("id", storedPayment.order_id),
        admin.from("commissions").update({ status: "reversed", reversed_at: new Date().toISOString() }).eq("payment_id", storedPayment.id),
      ]);
    }

    await admin.from("webhook_events").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", event.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    await admin.from("webhook_events").update({ status: "failed", error_message: error instanceof Error ? error.message.slice(0, 1000) : "Erro desconhecido" }).eq("id", event.id);
    console.error(error);
    return NextResponse.json({ error: "Falha ao processar notificacao." }, { status: 500 });
  }
}
