import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { mercadoPagoPaymentMetadata } from "@/lib/payments/mercado-pago-payment-metadata";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ productId: string }> };

export async function GET(_: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const { data: owns, error: ownsError } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (ownsError) throw ownsError;
    if (!owns) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

    const admin = createAdminClient();
    const [offersResult, ordersResult] = await Promise.all([
      admin.from("offers")
        .select("id,name,payment_card_enabled,payment_pix_enabled,primary_payment_method")
        .eq("product_id", productId)
        .order("created_at", { ascending: true }),
      admin.from("orders")
        .select("id,offer_id,customer_id,status,gross_amount_cents,settlement_model,created_at,paid_at")
        .eq("product_id", productId)
        .order("created_at", { ascending: false })
        .limit(500),
    ]);
    if (offersResult.error || ordersResult.error) throw offersResult.error ?? ordersResult.error;

    const offers = offersResult.data ?? [];
    const orders = ordersResult.data ?? [];
    const orderIds = orders.map(order => order.id);
    const customerIds = Array.from(new Set(orders.map(order => order.customer_id).filter(Boolean)));

    const [paymentsResult, customersResult, snapshotsResult] = await Promise.all([
      orderIds.length
        ? admin.from("payments")
          .select("id,order_id,status,external_payment_id,external_reference,gross_amount_cents,provider_fee_amount_cents,created_at,paid_at,raw_provider_data")
          .in("order_id", orderIds)
          .order("created_at", { ascending: false })
          .limit(500)
        : Promise.resolve({ data: [], error: null }),
      customerIds.length
        ? admin.from("customers").select("id,name,email,phone").in("id", customerIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? admin.from("financial_snapshots")
          .select("order_id,gateway_fee_amount_cents,prosperity_fee_amount_cents,affiliate_amount_cents,coproducer_amount_cents,producer_amount_cents")
          .in("order_id", orderIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (paymentsResult.error || customersResult.error || snapshotsResult.error) {
      throw paymentsResult.error ?? customersResult.error ?? snapshotsResult.error;
    }

    const payments = paymentsResult.data ?? [];
    const paymentIds = payments.map(payment => payment.id);
    const transactionsResult = paymentIds.length
      ? await admin.from("payment_transactions")
        .select("id,payment_id,transaction_type,status,occurred_at,created_at")
        .in("payment_id", paymentIds)
        .order("created_at", { ascending: false })
      : { data: [], error: null };
    if (transactionsResult.error) throw transactionsResult.error;

    const orderMap = new Map(orders.map(order => [order.id, order]));
    const offerMap = new Map(offers.map(offer => [offer.id, offer]));
    const customerMap = new Map((customersResult.data ?? []).map(customer => [customer.id, customer]));
    const snapshotMap = new Map((snapshotsResult.data ?? []).map(snapshot => [snapshot.order_id, snapshot]));
    const transactionsByPayment = new Map<string, typeof transactionsResult.data>();
    for (const transaction of transactionsResult.data ?? []) {
      const current = transactionsByPayment.get(transaction.payment_id) ?? [];
      current.push(transaction);
      transactionsByPayment.set(transaction.payment_id, current);
    }

    const rows = payments.flatMap(payment => {
      const order = orderMap.get(payment.order_id);
      if (!order) return [];
      const offer = offerMap.get(order.offer_id);
      const customer = customerMap.get(order.customer_id);
      const snapshot = snapshotMap.get(order.id);
      const metadata = mercadoPagoPaymentMetadata(payment.raw_provider_data);
      return [{
        id: payment.id,
        order_id: order.id,
        offer_id: order.offer_id,
        offer_name: offer?.name ?? "Oferta",
        customer_name: customer?.name ?? null,
        customer_email: customer?.email ?? "—",
        customer_phone: customer?.phone ?? null,
        amount_cents: Number(payment.gross_amount_cents ?? order.gross_amount_cents ?? 0),
        status: payment.status,
        order_status: order.status,
        settlement_model: order.settlement_model,
        created_at: payment.created_at,
        paid_at: payment.paid_at ?? order.paid_at,
        external_payment_id: payment.external_payment_id,
        external_reference: payment.external_reference,
        provider_fee_amount_cents: Number(payment.provider_fee_amount_cents ?? 0),
        allowed_methods: {
          card: Boolean(offer?.payment_card_enabled),
          pix: Boolean(offer?.payment_pix_enabled),
          primary: offer?.primary_payment_method ?? "card",
        },
        actual_method: metadata.method,
        provider_method_id: metadata.method_id,
        payment_type_id: metadata.payment_type_id,
        status_detail: metadata.status_detail,
        installments: metadata.installments,
        card_last_four: metadata.card_last_four,
        provider_created_at: metadata.provider_created_at,
        provider_approved_at: metadata.provider_approved_at,
        financial: snapshot ? {
          gateway_fee_amount_cents: Number(snapshot.gateway_fee_amount_cents ?? 0),
          prosperity_fee_amount_cents: Number(snapshot.prosperity_fee_amount_cents ?? 0),
          affiliate_amount_cents: Number(snapshot.affiliate_amount_cents ?? 0),
          coproducer_amount_cents: Number(snapshot.coproducer_amount_cents ?? 0),
          producer_amount_cents: Number(snapshot.producer_amount_cents ?? 0),
        } : null,
        events: transactionsByPayment.get(payment.id) ?? [],
      }];
    });

    return NextResponse.json({
      offers: offers.map(offer => ({ id: offer.id, name: offer.name })),
      payments: rows,
    });
  } catch (error) {
    return jsonError(error);
  }
}
