import { NextResponse } from "next/server";
import { fetchMercadoPagoOrder, syncTransparentOrder } from "@/lib/checkout/transparent-checkout-service";
import { deliverCrmProsperityWebhookForOrder } from "@/lib/integrations/crm-prosperity-order-delivery";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: order } = await admin.from("orders")
    .select("status,payment_provider_checkouts(connection_id,external_checkout_id)")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });

  if (order.status === "pending_payment" || order.status === "draft") {
    const checkout = Array.isArray(order.payment_provider_checkouts)
      ? order.payment_provider_checkouts[0]
      : order.payment_provider_checkouts;
    if (checkout?.external_checkout_id?.startsWith("ORD")) {
      try {
        const mpOrder = await fetchMercadoPagoOrder(checkout.connection_id, checkout.external_checkout_id);
        await syncTransparentOrder({ admin, internalOrderId: orderId, mpOrder });
        await deliverCrmProsperityWebhookForOrder(admin, orderId);
        const { data: refreshed } = await admin.from("orders").select("status").eq("id", orderId).single();
        if (refreshed) return NextResponse.json({ status: refreshed.status }, { headers: { "Cache-Control": "no-store" } });
      } catch {
        // O webhook continua sendo a fonte de verdade; mantém o último status conhecido.
      }
    }
  }

  // Auto-reparo: um pedido pode ter sido confirmado pelo polling antes de a
  // integração com o CRM ser entregue. A entrega é idempotente e, portanto,
  // pode ser garantida novamente quando consultamos um pedido já pago.
  if (order.status === "paid") {
    await deliverCrmProsperityWebhookForOrder(admin, orderId);
  }

  return NextResponse.json({ status: order.status }, { headers: { "Cache-Control": "no-store" } });
}
