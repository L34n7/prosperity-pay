import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getProviderAccessToken } from "@/lib/payments/provider-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Execução única de cancelamento financeiro previamente autorizado.
 * Exige token aleatório armazenado em subscription_billing_deliveries.
 * O link não aceita instruções de cancelar uma assinatura arbitrária.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const deliveryId = url.searchParams.get("delivery") || "";
  const nonce = url.searchParams.get("nonce") || "";

  if (!uuid(deliveryId) || !uuid(nonce)) {
    return NextResponse.json({ ok: false, error: "Requisição inválida." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: delivery, error: deliveryError } = await admin
    .from("subscription_billing_deliveries")
    .select("id,subscription_id,order_id,payment_id,status,last_error")
    .eq("id", deliveryId)
    .eq("status", "failed")
    .eq("last_error", "cancel_pending:" + nonce)
    .maybeSingle();

  if (deliveryError) {
    return NextResponse.json({ ok: false, error: "Falha ao consultar a solicitação." }, { status: 500 });
  }
  if (!delivery?.subscription_id || !delivery.order_id || !delivery.payment_id) {
    return NextResponse.json({ ok: false, error: "Solicitação inexistente ou já utilizada." }, { status: 404 });
  }

  const [{ data: subscription }, { data: order }, { data: payment }, { data: checkout }] = await Promise.all([
    admin.from("subscriptions").select("id,status,external_reference").eq("id", delivery.subscription_id).maybeSingle(),
    admin.from("orders").select("id,status,billing_reason,subscription_id").eq("id", delivery.order_id).maybeSingle(),
    admin.from("payments").select("id,status,connection_id,order_id").eq("id", delivery.payment_id).maybeSingle(),
    admin.from("payment_provider_checkouts").select("external_checkout_id").eq("order_id", delivery.order_id).maybeSingle(),
  ]);

  if (
    subscription?.status !== "cancelled" ||
    !String(subscription.external_reference || "").startsWith("crm_prosperity:") ||
    order?.subscription_id !== subscription.id ||
    order?.billing_reason !== "subscription_renewal" ||
    !["pending_payment", "cancelled"].includes(String(order?.status || "")) ||
    payment?.order_id !== order.id ||
    !["pending", "processing", "cancelled"].includes(String(payment?.status || "")) ||
    !payment.connection_id ||
    !String(checkout?.external_checkout_id || "").startsWith("ORD")
  ) {
    return NextResponse.json({ ok: false, error: "Condições de segurança não atendidas." }, { status: 409 });
  }

  const externalOrderId = String(checkout.external_checkout_id);
  const endpoint = "https://api.mercadopago.com/v1/orders/" + encodeURIComponent(externalOrderId);
  let remoteCancelled = false;
  let httpStatus = 0;

  try {
    const token = await getProviderAccessToken(payment.connection_id);
    const headers = {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "X-Idempotency-Key": "cancel-crm-legacy-" + delivery.id,
    };
    const result = await fetch(endpoint + "/cancel", {
      method: "POST",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    httpStatus = result.status;
    if (result.ok) {
      const payload = await result.json().catch(() => ({}));
      remoteCancelled = payload?.status === "canceled" || payload?.status === "cancelled";
    }

    if (!remoteCancelled) {
      const verification = await fetch(endpoint, {
        method: "GET",
        headers: { Authorization: "Bearer " + token },
        cache: "no-store",
        signal: AbortSignal.timeout(20000),
      });
      if (verification.ok) {
        const actual = await verification.json();
        remoteCancelled = actual?.status === "canceled" || actual?.status === "cancelled";
      }
    }
  } catch (error) {
    console.error("[CANCEL PENDING BILLING] Provedor indisponível", {
      deliveryId, message: error instanceof Error ? error.message : "Erro remoto",
    });
  }

  if (!remoteCancelled) {
    return NextResponse.json(
      { ok: false, error: "O cancelamento não foi confirmado no Mercado Pago.", provider_status: httpStatus },
      { status: 502 },
    );
  }

  const now = new Date().toISOString();
  const results = await Promise.all([
    admin.from("payments").update({
      status: "cancelled",
      status_detail: "subscription_cancelled_legacy_crm",
      updated_at: now,
    }).eq("id", payment.id).in("status", ["pending", "processing"]),
    admin.from("orders").update({
      status: "cancelled",
      cancelled_at: now,
      updated_at: now,
    }).eq("id", order.id).eq("status", "pending_payment"),
    admin.from("subscription_checkout_sessions").update({ expires_at: now })
      .eq("order_id", order.id).is("consumed_at", null),
  ]);

  const failure = results.find((result) => result.error);
  if (failure?.error) {
    return NextResponse.json(
      { ok: false, error: "Mercado Pago cancelado; falha de sincronização interna: " + failure.error.message },
      { status: 500 },
    );
  }

  const { error: finishError } = await admin.from("subscription_billing_deliveries")
    .update({
      status: "skipped",
      last_error: "cancelled_after_notification_sent",
      pix_code: null,
      pix_ticket_url: null,
      checkout_url: null,
      updated_at: now,
    })
    .eq("id", delivery.id)
    .eq("last_error", "cancel_pending:" + nonce);

  if (finishError) {
    return NextResponse.json(
      { ok: false, error: "Mercado Pago cancelado; falha na finalização do histórico." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    remote_cancelled: true,
    payment_cancelled: true,
    checkout_invalidated: true,
    subscription_id: subscription.id,
  }, { headers: { "Cache-Control": "no-store" } });
}
