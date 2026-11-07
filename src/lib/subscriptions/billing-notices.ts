import { createAdminClient } from "@/lib/supabase/admin";
import { sendSubscriptionBillingNoticeEmail } from "@/lib/email/resend-auth";

type NoticeType = "pre_due_3d" | "overdue_3d" | "overdue_6d";
const DAY = 24 * 60 * 60 * 1000;

/**
 * Avisos financeiros do produto habilitado para cobrança automática.
 * Pré-vencimento NÃO cria cobrança; lembretes usam apenas o checkout já enviado.
 * O ciclo, a data e o tipo formam uma chave de idempotência persistida no banco.
 */
export async function processSubscriptionBillingNotices(limit = 150) {
  const admin = createAdminClient();
  const now = new Date();
  const nowMs = now.getTime();
  const from = new Date(nowMs - 7 * DAY).toISOString();
  const to = new Date(nowMs + 3 * DAY).toISOString();

  const { data: subscriptions, error } = await admin
    .from("subscriptions")
    .select("id,product_id,customer_id,status,billing_model,current_period_end,current_amount_cents")
    .eq("billing_model", "prepaid")
    .in("status", ["active", "past_due"])
    .not("current_period_end", "is", null)
    .gte("current_period_end", from)
    .lte("current_period_end", to)
    .order("current_period_end", { ascending: true })
    .limit(Math.max(1, Math.min(500, limit)));

  if (error) throw error;
  if (!subscriptions?.length) return { analyzed: 0, sent: 0, skipped: 0, failed: 0 };

  const productIds = [...new Set(subscriptions.map((s) => s.product_id))];
  const { data: products, error: productsError } = await (admin as any)
    .from("products")
    .select("id,name,status,automatic_due_billing_enabled")
    .in("id", productIds);
  if (productsError) throw productsError;
  const productById = new Map<string, any>((products ?? []).map((p: any) => [String(p.id), p]));

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    const product = productById.get(subscription.product_id);
    if (product?.status !== "active" || product.automatic_due_billing_enabled !== true) {
      skipped++;
      continue;
    }
    const dueAt = String(subscription.current_period_end ?? "");
    const dueMs = Date.parse(dueAt);
    if (!Number.isFinite(dueMs)) { skipped++; continue; }
    const age = nowMs - dueMs;
    let noticeType: NoticeType | null = null;
    if (age < 0 && age >= -3 * DAY && subscription.status === "active") {
      noticeType = "pre_due_3d";
    } else if (age >= 3 * DAY && age < 4 * DAY && subscription.status === "past_due") {
      noticeType = "overdue_3d";
    } else if (age >= 6 * DAY && age < 7 * DAY && subscription.status === "past_due") {
      noticeType = "overdue_6d";
    }
    if (!noticeType) { skipped++; continue; }

    let checkoutUrl: string | null = null;
    let amountCents = Number(subscription.current_amount_cents || 0);
    if (noticeType !== "pre_due_3d") {
      const { data: delivery, error: deliveryError } = await (admin as any)
        .from("subscription_billing_deliveries")
        .select("status,order_id,checkout_url")
        .eq("subscription_id", subscription.id)
        .eq("due_at", dueAt)
        .maybeSingle();
      if (deliveryError) { failed++; console.error("[BILLING NOTICES] Erro na entrega da cobrança", deliveryError); continue; }
      if (delivery?.status !== "sent" || !delivery.order_id || !delivery.checkout_url) {
        skipped++;
        continue;
      }
      const { data: order, error: orderError } = await admin
        .from("orders").select("status,gross_amount_cents")
        .eq("id", delivery.order_id).eq("subscription_id", subscription.id).maybeSingle();
      if (orderError) { failed++; console.error("[BILLING NOTICES] Erro ao verificar pedido", orderError); continue; }
      if (order?.status !== "pending_payment") { skipped++; continue; }
      checkoutUrl = delivery.checkout_url;
      amountCents = Number(order.gross_amount_cents || 0);
    }

    const { data: customer, error: customerError } = await admin
      .from("customers").select("name,email")
      .eq("id", subscription.customer_id).maybeSingle();
    if (customerError || !customer?.email) {
      skipped++;
      continue;
    }

    const { data: original, error: claimError } = await (admin as any)
      .from("subscription_billing_notices")
      .insert({
        subscription_id: subscription.id,
        product_id: subscription.product_id,
        customer_id: subscription.customer_id,
        due_at: dueAt,
        notice_type: noticeType,
        recipient_email: customer.email,
        status: "processing",
      })
      .select("id")
      .single();
    let noticeId = original?.id || null;
    if (claimError) {
      if (claimError.code !== "23505") {
        failed++;
        console.error("[BILLING NOTICES] Falha ao reservar aviso", claimError);
        continue;
      }
      // Apenas tentativas com falha (ou trava antiga) podem ser retomadas.
      const { data: stale, error: staleError } = await (admin as any)
        .from("subscription_billing_notices")
        .select("id,status,attempts,updated_at")
        .eq("subscription_id", subscription.id)
        .eq("due_at", dueAt)
        .eq("notice_type", noticeType)
        .maybeSingle();
      if (staleError || !stale || ["sent", "skipped"].includes(stale.status)) { skipped++; continue; }
      if (new Date(stale.updated_at).getTime() > nowMs - 60 * 60 * 1000) {
        skipped++;
        continue;
      }
      const { data: claimed } = await (admin as any)
        .from("subscription_billing_notices")
        .update({ status: "processing", attempts: Number(stale.attempts || 1) + 1, last_error: null })
        .eq("id", stale.id)
        .eq("status", stale.status)
        .eq("updated_at", stale.updated_at)
        .select("id")
        .maybeSingle();
      if (!claimed) { skipped++; continue; }
      noticeId = claimed.id;
    }
    if (!noticeId) { skipped++; continue; }

    try {
      // Revalida o ciclo antes do envio, pois pagamentos e alterações ocorrem em paralelo.
      const { data: latest, error: latestError } = await admin
        .from("subscriptions").select("status,current_period_end")
        .eq("id", subscription.id).single();
      if (latestError || latest?.current_period_end !== dueAt
        || (noticeType === "pre_due_3d" && latest.status !== "active")
        || (noticeType !== "pre_due_3d" && latest.status !== "past_due")) {
        await (admin as any).from("subscription_billing_notices")
          .update({ status: "skipped", last_error: "cycle_or_status_changed" }).eq("id", noticeId);
        skipped++;
        continue;
      }
      if (noticeType !== "pre_due_3d") {
        // Não reenviar lembrete quando o pedido já estiver pago.
        const { data: delivery } = await (admin as any).from("subscription_billing_deliveries")
          .select("order_id").eq("subscription_id", subscription.id).eq("due_at", dueAt).maybeSingle();
        const { data: order } = await admin.from("orders").select("status")
          .eq("id", delivery?.order_id || "00000000-0000-0000-0000-000000000000").maybeSingle();
        if (order?.status !== "pending_payment") {
          await (admin as any).from("subscription_billing_notices")
            .update({ status: "skipped", last_error: "order_no_longer_pending" }).eq("id", noticeId);
          skipped++;
          continue;
        }
      }
      await sendSubscriptionBillingNoticeEmail({
        to: customer.email,
        name: customer.name || "cliente",
        productName: product.name || "CRM Prosperity",
        noticeType,
        dueAt,
        amountCents,
        checkoutUrl,
      });
      const { error: updateError } = await (admin as any).from("subscription_billing_notices")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null }).eq("id", noticeId);
      if (updateError) throw updateError;
      sent++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      await (admin as any).from("subscription_billing_notices")
        .update({ status: "failed", last_error: message.slice(0, 1000) }).eq("id", noticeId);
      console.error("[BILLING NOTICES] Falha no aviso", { subscriptionId: subscription.id, noticeType, error: message });
    }
  }
  return { analyzed: subscriptions.length, sent, skipped, failed };
}
