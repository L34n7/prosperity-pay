import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { expireStalePayments } from "@/lib/payments/expire-stale-payments";
import { mercadoPagoPaymentMetadata, type MercadoPagoPaymentMethod } from "@/lib/payments/mercado-pago-payment-metadata";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ productId: string }> };
type PaymentMethod = MercadoPagoPaymentMethod;

type MutableStats = {
  sales_count: number;
  total_sales_cents: number;
  pix_count: number;
  pix_sales_cents: number;
  card_count: number;
  card_sales_cents: number;
  other_count: number;
  other_sales_cents: number;
};

function emptyStats(): MutableStats {
  return {
    sales_count: 0,
    total_sales_cents: 0,
    pix_count: 0,
    pix_sales_cents: 0,
    card_count: 0,
    card_sales_cents: 0,
    other_count: 0,
    other_sales_cents: 0,
  };
}

function addSale(stats: MutableStats, amountCents: number, method: PaymentMethod) {
  stats.sales_count += 1;
  stats.total_sales_cents += amountCents;
  if (method === "pix") {
    stats.pix_count += 1;
    stats.pix_sales_cents += amountCents;
  } else if (method === "card") {
    stats.card_count += 1;
    stats.card_sales_cents += amountCents;
  } else {
    stats.other_count += 1;
    stats.other_sales_cents += amountCents;
  }
}

function metadataText(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

export async function GET(_: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const { data: owns, error: ownsError } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (ownsError) throw ownsError;
    if (!owns) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

    const admin = createAdminClient();
    await expireStalePayments(admin, { productId });
    const [offersResult, ordersResult, programResult, participantsResult] = await Promise.all([
      admin.from("offers").select("id,name,status,price_cents,billing_type").eq("product_id", productId).order("created_at", { ascending: true }),
      admin.from("orders").select("id,offer_id,customer_id,gross_amount_cents,paid_at").eq("product_id", productId).eq("status", "paid").order("paid_at", { ascending: false }),
      admin.from("affiliate_programs").select("id,active,mode").eq("product_id", productId).maybeSingle(),
      admin.from("product_participants").select("id,user_id,offer_id,participation_bps,active,invitation_id").eq("product_id", productId).eq("active", true),
    ]);

    const firstError = offersResult.error || ordersResult.error || programResult.error || participantsResult.error;
    if (firstError) throw firstError;

    const offers = offersResult.data ?? [];
    const orders = ordersResult.data ?? [];
    const participants = participantsResult.data ?? [];
    const orderIds = orders.map(order => order.id);
    const customerIds = Array.from(new Set(orders.map(order => order.customer_id).filter(Boolean)));

    const membersResult = programResult.data
      ? await admin.from("affiliate_memberships").select("id,user_id,code,status").eq("program_id", programResult.data.id)
      : { data: [], error: null };
    if (membersResult.error) throw membersResult.error;
    const members = membersResult.data ?? [];

    const participantUserIds = participants.map(item => item.user_id);
    const memberUserIds = members.map(item => item.user_id);
    const userIds = Array.from(new Set([...participantUserIds, ...memberUserIds]));
    const profileResult = userIds.length
      ? await admin.from("profiles").select("id,full_name,email").in("id", userIds)
      : { data: [], error: null };
    if (profileResult.error) throw profileResult.error;
    const profiles = new Map((profileResult.data ?? []).map(profile => [profile.id, profile]));

    const invitationIds = participants.map(item => item.invitation_id).filter((value): value is string => Boolean(value));
    const invitationResult = invitationIds.length
      ? await admin.from("coproducer_invitations").select("id,invited_email").in("id", invitationIds)
      : { data: [], error: null };
    if (invitationResult.error) throw invitationResult.error;
    const invitationEmails = new Map((invitationResult.data ?? []).map(invitation => [invitation.id, invitation.invited_email]));

    const [paymentsResult, customersResult] = await Promise.all([
      orderIds.length
        ? admin.from("payments").select("order_id,raw_provider_data,created_at").eq("status", "approved").in("order_id", orderIds).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      customerIds.length
        ? admin.from("customers").select("id,name,email").in("id", customerIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (paymentsResult.error || customersResult.error) {
      throw paymentsResult.error ?? customersResult.error;
    }

    const paymentByOrder = new Map<string, PaymentMethod>();
    const paymentRawByOrder = new Map<string, unknown>();
    for (const payment of paymentsResult.data ?? []) {
      if (!paymentByOrder.has(payment.order_id)) {
        paymentByOrder.set(payment.order_id, mercadoPagoPaymentMetadata(payment.raw_provider_data).method);
        paymentRawByOrder.set(payment.order_id, payment.raw_provider_data);
      }
    }
    const customers = new Map((customersResult.data ?? []).map(customer => [customer.id, customer]));

    const attributionsResult = orderIds.length
      ? await admin.from("affiliate_attributions").select("order_id,affiliate_membership_id").in("order_id", orderIds)
      : { data: [], error: null };
    if (attributionsResult.error) throw attributionsResult.error;
    const attributionByOrder = new Map<string, string>();
    for (const attribution of attributionsResult.data ?? []) {
      if (attribution.order_id) attributionByOrder.set(attribution.order_id, attribution.affiliate_membership_id);
    }

    const snapshotsResult = orderIds.length
      ? await admin.from("financial_snapshots").select("id,order_id").in("order_id", orderIds)
      : { data: [], error: null };
    if (snapshotsResult.error) throw snapshotsResult.error;
    const snapshots = snapshotsResult.data ?? [];
    const snapshotToOrder = new Map(snapshots.map(snapshot => [snapshot.id, snapshot.order_id]));
    const snapshotIds = snapshots.map(snapshot => snapshot.id);

    const allocationsResult = snapshotIds.length
      ? await admin.from("financial_allocations")
        .select("snapshot_id,allocation_type,beneficiary_user_id,amount_cents")
        .in("snapshot_id", snapshotIds)
        .in("allocation_type", ["affiliate", "coproducer"])
      : { data: [], error: null };
    if (allocationsResult.error) throw allocationsResult.error;

    const ordersById = new Map(orders.map(order => [order.id, order]));
    const offersById = new Map(offers.map(offer => [offer.id, offer]));
    const offerStats = new Map(offers.map(offer => [offer.id, { ...emptyStats(), affiliate_sales_count: 0, direct_sales_count: 0 }]));
    const overall = emptyStats();

    for (const order of orders) {
      const amount = Number(order.gross_amount_cents ?? 0);
      const method = paymentByOrder.get(order.id) ?? "other";
      addSale(overall, amount, method);
      const stats = offerStats.get(order.offer_id);
      if (stats) {
        addSale(stats, amount, method);
        if (attributionByOrder.has(order.id)) stats.affiliate_sales_count += 1;
        else stats.direct_sales_count += 1;
      }
    }

    const affiliatePerformance = new Map(members.map(member => [member.id, {
      sales_count: 0,
      total_sales_cents: 0,
      commission_cents: 0,
      order_ids: new Set<string>(),
    }]));

    for (const [orderId, membershipId] of attributionByOrder) {
      const performance = affiliatePerformance.get(membershipId);
      const order = ordersById.get(orderId);
      if (!performance || !order || performance.order_ids.has(orderId)) continue;
      performance.order_ids.add(orderId);
      performance.sales_count += 1;
      performance.total_sales_cents += Number(order.gross_amount_cents ?? 0);
    }

    const coproducerPerformance = new Map<string, {
      sales_count: number;
      total_sales_cents: number;
      participation_cents: number;
      order_ids: Set<string>;
    }>();
    for (const participant of participants) {
      if (!coproducerPerformance.has(participant.user_id)) {
        coproducerPerformance.set(participant.user_id, { sales_count: 0, total_sales_cents: 0, participation_cents: 0, order_ids: new Set() });
      }
    }

    const userToMembership = new Map(members.map(member => [member.user_id, member.id]));
    for (const allocation of allocationsResult.data ?? []) {
      if (!allocation.beneficiary_user_id) continue;
      const orderId = snapshotToOrder.get(allocation.snapshot_id);
      if (!orderId) continue;
      const order = ordersById.get(orderId);
      if (!order) continue;
      const amount = Number(allocation.amount_cents ?? 0);

      if (allocation.allocation_type === "affiliate") {
        const membershipId = userToMembership.get(allocation.beneficiary_user_id);
        const performance = membershipId ? affiliatePerformance.get(membershipId) : undefined;
        if (performance) performance.commission_cents += amount;
      }

      if (allocation.allocation_type === "coproducer") {
        const performance = coproducerPerformance.get(allocation.beneficiary_user_id);
        if (!performance) continue;
        performance.participation_cents += amount;
        if (!performance.order_ids.has(orderId)) {
          performance.order_ids.add(orderId);
          performance.sales_count += 1;
          performance.total_sales_cents += Number(order.gross_amount_cents ?? 0);
        }
      }
    }

    const activeMembers = members.filter(member => member.status === "active");
    const uniqueCoproducerUsers = Array.from(new Set(participants.map(item => item.user_id)));

    return NextResponse.json({
      summary: {
        offer_count: offers.length,
        active_offer_count: offers.filter(offer => offer.status === "active").length,
        affiliate_count: activeMembers.length,
        coproducer_count: uniqueCoproducerUsers.length,
        completed_sales: overall.sales_count,
        total_sales_cents: overall.total_sales_cents,
        average_ticket_cents: overall.sales_count ? Math.round(overall.total_sales_cents / overall.sales_count) : 0,
        pix_sales: overall.pix_count,
        pix_sales_cents: overall.pix_sales_cents,
        card_sales: overall.card_count,
        card_sales_cents: overall.card_sales_cents,
        other_sales: overall.other_count,
        other_sales_cents: overall.other_sales_cents,
      },
      sales: orders.map(order => {
        const customer = customers.get(order.customer_id);
        const offer = offersById.get(order.offer_id);
        const raw = paymentRawByOrder.get(order.id);
        return {
          id: order.id,
          customer_name: customer?.name || "Comprador",
          customer_email:
            customer?.email && !customer.email.endsWith(".invalid")
              ? customer.email
              : "E-mail não informado",
          plan_name: metadataText(raw, "plan_label") ?? offer?.name ?? "Plano não identificado",
          offer_name: offer?.name ?? "Oferta",
          amount_cents: Number(order.gross_amount_cents ?? 0),
          paid_at: order.paid_at,
          affiliate_sale: attributionByOrder.has(order.id),
        };
      }),
      offers: offers.map(offer => ({
        id: offer.id,
        name: offer.name,
        status: offer.status,
        price_cents: Number(offer.price_cents),
        billing_type: offer.billing_type,
        ...(offerStats.get(offer.id) ?? { ...emptyStats(), affiliate_sales_count: 0, direct_sales_count: 0 }),
      })),
      affiliates: activeMembers.map(member => {
        const profile = profiles.get(member.user_id);
        const performance = affiliatePerformance.get(member.id);
        return {
          id: member.id,
          user_id: member.user_id,
          name: profile?.full_name || profile?.email || "Afiliado",
          code: member.code,
          sales_count: performance?.sales_count ?? 0,
          total_sales_cents: performance?.total_sales_cents ?? 0,
          commission_cents: performance?.commission_cents ?? 0,
        };
      }).sort((a, b) => b.total_sales_cents - a.total_sales_cents),
      coproducers: participants.map(participant => {
        const profile = profiles.get(participant.user_id);
        const performance = coproducerPerformance.get(participant.user_id);
        return {
          id: participant.id,
          user_id: participant.user_id,
          name: profile?.full_name || profile?.email || (participant.invitation_id ? invitationEmails.get(participant.invitation_id) : null) || "Coprodutor",
          email: profile?.email || (participant.invitation_id ? invitationEmails.get(participant.invitation_id) : null) || null,
          participation_bps: participant.participation_bps,
          offer_id: participant.offer_id,
          sales_count: performance?.sales_count ?? 0,
          total_sales_cents: performance?.total_sales_cents ?? 0,
          participation_cents: performance?.participation_cents ?? 0,
        };
      }).sort((a, b) => b.total_sales_cents - a.total_sales_cents),
    });
  } catch (error) {
    return jsonError(error);
  }
}
