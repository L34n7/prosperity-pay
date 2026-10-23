import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { expireStalePayments } from "@/lib/payments/expire-stale-payments";
import { mercadoPagoPaymentMetadata } from "@/lib/payments/mercado-pago-payment-metadata";
import { isHiddenTestPayment } from "@/lib/payments/payment-visibility";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchPaymentEmailNotificationsSafe } from "@/lib/email/payment-notifications";

type Context = { params: Promise<{ productId: string }> };

function metadataText(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

export async function GET(_: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const { data: owns, error: ownsError } = await supabase.rpc("owns_product", {
      target_product_id: productId,
    });
    if (ownsError) throw ownsError;
    if (!owns) {
      return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
    }

    const admin = createAdminClient();
    await expireStalePayments(admin, { productId });

    const [offersResult, ordersResult, programResult] = await Promise.all([
      admin
        .from("offers")
        .select("id,name,payment_card_enabled,payment_pix_enabled,primary_payment_method")
        .eq("product_id", productId)
        .order("created_at", { ascending: true }),
      admin
        .from("orders")
        .select(
          "id,offer_id,customer_id,status,gross_amount_cents,settlement_model,created_at,paid_at",
        )
        .eq("product_id", productId)
        .order("created_at", { ascending: false })
        .limit(500),
      admin
        .from("affiliate_programs")
        .select("id")
        .eq("product_id", productId)
        .maybeSingle(),
    ]);

    if (offersResult.error || ordersResult.error || programResult.error) {
      throw offersResult.error ?? ordersResult.error ?? programResult.error;
    }

    const offers = offersResult.data ?? [];
    const orders = ordersResult.data ?? [];
    const orderIds = orders.map((order) => order.id);
    const customerIds = Array.from(
      new Set(orders.map((order) => order.customer_id).filter(Boolean)),
    );

    const [paymentsResult, customersResult, snapshotsResult] = await Promise.all([
      orderIds.length
        ? admin
            .from("payments")
            .select(
              "id,order_id,status,external_payment_id,external_reference,gross_amount_cents,provider_fee_amount_cents,created_at,paid_at,raw_provider_data",
            )
            .in("order_id", orderIds)
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
      customerIds.length
        ? admin.from("customers").select("id,name,email,phone").in("id", customerIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? admin
            .from("financial_snapshots")
            .select(
              "order_id,gateway_fee_amount_cents,prosperity_fee_amount_cents,affiliate_amount_cents,coproducer_amount_cents,producer_amount_cents",
            )
            .in("order_id", orderIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (paymentsResult.error || customersResult.error || snapshotsResult.error) {
      throw paymentsResult.error ?? customersResult.error ?? snapshotsResult.error;
    }

    const payments = (paymentsResult.data ?? []).filter((payment) => !isHiddenTestPayment(payment.raw_provider_data));
    const paymentIds = payments.map((payment) => payment.id);

    const [transactionsResult, attributionsResult, partnerCommissionsResult] =
      await Promise.all([
        paymentIds.length
          ? admin
              .from("payment_transactions")
              .select("id,payment_id,transaction_type,status,occurred_at,created_at")
              .in("payment_id", paymentIds)
              .order("created_at", { ascending: false })
          : Promise.resolve({ data: [], error: null }),
        orderIds.length
          ? admin
              .from("affiliate_attributions")
              .select("order_id,affiliate_membership_id")
              .in("order_id", orderIds)
          : Promise.resolve({ data: [], error: null }),
        paymentIds.length
          ? admin
              .from("commissions")
              .select("payment_id,beneficiary_user_id,commission_type,status")
              .in("payment_id", paymentIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (
      transactionsResult.error ||
      attributionsResult.error ||
      partnerCommissionsResult.error
    ) {
      throw (
        transactionsResult.error ||
        attributionsResult.error ||
        partnerCommissionsResult.error
      );
    }

    const attributionMembershipIds = Array.from(
      new Set(
        (attributionsResult.data ?? [])
          .map((item) => item.affiliate_membership_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const partnerBeneficiaryIds = Array.from(
      new Set(
        (partnerCommissionsResult.data ?? [])
          .filter(
            (commission) =>
              ["affiliate", "accredited"].includes(commission.commission_type) &&
              commission.status !== "cancelled" &&
              commission.status !== "reversed",
          )
          .map((commission) => commission.beneficiary_user_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const [attributedMembershipsResult, beneficiaryMembershipsResult] =
      await Promise.all([
        attributionMembershipIds.length
          ? admin
              .from("affiliate_memberships")
              .select("id,partner_type")
              .in("id", attributionMembershipIds)
          : Promise.resolve({ data: [], error: null }),
        programResult.data && partnerBeneficiaryIds.length
          ? admin
              .from("affiliate_memberships")
              .select("user_id,partner_type,status,updated_at")
              .eq("program_id", programResult.data.id)
              .in("user_id", partnerBeneficiaryIds)
          : Promise.resolve({ data: [], error: null }),
      ]);

    if (
      attributedMembershipsResult.error ||
      beneficiaryMembershipsResult.error
    ) {
      throw (
        attributedMembershipsResult.error ||
        beneficiaryMembershipsResult.error
      );
    }

    const typeByMembershipId = new Map(
      (attributedMembershipsResult.data ?? []).map((membership) => [
        membership.id,
        membership.partner_type,
      ]),
    );
    const typeByBeneficiary = new Map<string, string>();
    for (const membership of [...(beneficiaryMembershipsResult.data ?? [])].sort(
      (a, b) => {
        const activeOrder =
          Number(b.status === "active") - Number(a.status === "active");
        if (activeOrder !== 0) return activeOrder;
        return String(b.updated_at).localeCompare(String(a.updated_at));
      },
    )) {
      if (!typeByBeneficiary.has(membership.user_id)) {
        typeByBeneficiary.set(membership.user_id, membership.partner_type);
      }
    }

    const partnerTypeByOrder = new Map<string, string>();
    for (const attribution of attributionsResult.data ?? []) {
      if (!attribution.order_id) continue;
      partnerTypeByOrder.set(
        attribution.order_id,
        typeByMembershipId.get(attribution.affiliate_membership_id) ?? "affiliate",
      );
    }
    const paymentOrderById = new Map(
      payments.map((payment) => [payment.id, payment.order_id]),
    );
    for (const commission of partnerCommissionsResult.data ?? []) {
      if (
        !["affiliate", "accredited"].includes(commission.commission_type) ||
        commission.status === "cancelled" ||
        commission.status === "reversed"
      ) continue;
      const orderId = paymentOrderById.get(commission.payment_id);
      if (!orderId) continue;
      if (commission.commission_type === "accredited") {
        partnerTypeByOrder.set(orderId, "accredited");
        continue;
      }
      if (partnerTypeByOrder.has(orderId)) continue;
      partnerTypeByOrder.set(
        orderId,
        typeByBeneficiary.get(commission.beneficiary_user_id) ?? "affiliate",
      );
    }

    const orderMap = new Map(orders.map((order) => [order.id, order]));
    const offerMap = new Map(offers.map((offer) => [offer.id, offer]));
    const customerMap = new Map(
      (customersResult.data ?? []).map((customer) => [customer.id, customer]),
    );
    const snapshotMap = new Map(
      (snapshotsResult.data ?? []).map((snapshot) => [snapshot.order_id, snapshot]),
    );
    const transactionsByPayment = new Map<string, typeof transactionsResult.data>();

    for (const transaction of transactionsResult.data ?? []) {
      const current = transactionsByPayment.get(transaction.payment_id) ?? [];
      current.push(transaction);
      transactionsByPayment.set(transaction.payment_id, current);
    }

    const rows = payments.flatMap((payment) => {
      const order = orderMap.get(payment.order_id);
      if (!order) return [];

      const offer = offerMap.get(order.offer_id);
      const customer = customerMap.get(order.customer_id);
      const snapshot = snapshotMap.get(order.id);
      const metadata = mercadoPagoPaymentMetadata(payment.raw_provider_data);
      const planName =
        metadataText(payment.raw_provider_data, "plan_label") ??
        offer?.name ??
        "Plano não identificado";

      return [
        {
          id: payment.id,
          order_id: order.id,
          offer_id: order.offer_id,
          offer_name: offer?.name ?? "Oferta",
          plan_name: planName,
          customer_name: customer?.name ?? null,
          customer_email:
            customer?.email && !customer.email.endsWith(".invalid")
              ? customer.email
              : "E-mail não informado",
          customer_phone: customer?.phone ?? null,
          amount_cents: Number(
            payment.gross_amount_cents ?? order.gross_amount_cents ?? 0,
          ),
          status: payment.status,
          order_status: order.status,
          settlement_model: order.settlement_model,
          created_at: payment.created_at,
          paid_at: payment.paid_at ?? order.paid_at,
          external_payment_id: payment.external_payment_id,
          external_reference: payment.external_reference,
          provider_fee_amount_cents: Number(payment.provider_fee_amount_cents ?? 0),
          partner_type: partnerTypeByOrder.get(order.id) ?? null,
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
          financial: snapshot
            ? {
                gateway_fee_amount_cents: Number(
                  snapshot.gateway_fee_amount_cents ?? 0,
                ),
                prosperity_fee_amount_cents: Number(
                  snapshot.prosperity_fee_amount_cents ?? 0,
                ),
                affiliate_amount_cents: Number(
                  snapshot.affiliate_amount_cents ?? 0,
                ),
                coproducer_amount_cents: Number(
                  snapshot.coproducer_amount_cents ?? 0,
                ),
                producer_amount_cents: Number(
                  snapshot.producer_amount_cents ?? 0,
                ),
              }
            : null,
          events: transactionsByPayment.get(payment.id) ?? [],
        },
      ];
    });

    return NextResponse.json({
      offers: offers.map((offer) => ({ id: offer.id, name: offer.name })),
      payments: rows,
    });
  } catch (error) {
    return jsonError(error);
  }
}


export async function POST(request: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase, user } = await requireUser();

    const { data: owns, error: ownsError } = await supabase.rpc("owns_product", {
      target_product_id: productId,
    });
    if (ownsError) throw ownsError;
    if (!owns) {
      return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });
    }

    const body = asObject(await request.json());
    const customerEmail =
      typeof body.customerEmail === "string" ? body.customerEmail.trim().toLowerCase() : "";
    const paymentMethod =
      body.paymentMethod === "card" ? "card" : "pix";
    const partnerRef =
      typeof body.partnerRef === "string" && body.partnerRef.trim()
        ? body.partnerRef.trim()
        : null;
    const paidAtInput =
      typeof body.paidAt === "string" && body.paidAt.trim()
        ? body.paidAt.trim()
        : null;

    if (!customerEmail || !/^\S+@\S+\.\S+$/.test(customerEmail)) {
      return NextResponse.json({ error: "Informe um e-mail válido." }, { status: 400 });
    }

    let paidAt: string | null = null;
    if (paidAtInput) {
      const parsed = new Date(paidAtInput);
      if (!Number.isFinite(parsed.getTime())) {
        return NextResponse.json({ error: "Data do pagamento inválida." }, { status: 400 });
      }
      paidAt = parsed.toISOString();
    }

    const admin = createAdminClient();
    const { data, error } = await (admin as any).rpc(
      "register_external_subscription_sale",
      {
        target_product_id: productId,
        customer_email: customerEmail,
        paid_at_override: paidAt,
        payment_method: paymentMethod,
        partner_ref: partnerRef,
        recorded_by: user.email ?? user.id,
      },
    );

    if (error) throw error;

    const sale = data as {
      reused?: boolean;
      payment_id?: string;
    } | null;

    if (sale?.payment_id && sale.reused !== true) {
      await dispatchPaymentEmailNotificationsSafe(admin, sale.payment_id);
    }

    return NextResponse.json({ sale: data }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
