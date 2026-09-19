import { deliverCrmProsperityPaymentWebhook } from "@/lib/integrations/crm-prosperity-webhook";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Entrega ao CRM o estado financeiro mais recente de um pedido.
 *
 * A entrega ao CRM já é idempotente por integração + pagamento + tipo de evento,
 * então esta função pode ser chamada tanto pelo webhook do Mercado Pago quanto
 * pelo polling do checkout sem risco de duplicar o processamento financeiro.
 *
 * Falhas da integração não revertem um pagamento que já foi confirmado pelo
 * provedor. Elas ficam registradas em integration_webhook_deliveries e são
 * reportadas no log para diagnóstico/reprocessamento.
 */
export async function deliverCrmProsperityWebhookForOrder(
  admin: AdminClient,
  orderId: string,
) {
  try {
    const { data: payment, error } = await admin
      .from("payments")
      .select("id,status")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (!payment) return { sent: false, reason: "payment_not_found" as const };

    return await deliverCrmProsperityPaymentWebhook({
      admin,
      paymentId: payment.id,
      paymentStatus: payment.status,
    });
  } catch (error) {
    console.error("[CRM PROSPERITY WEBHOOK] Falha ao entregar estado do pedido", {
      orderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { sent: false, reason: "delivery_failed" as const };
  }
}
