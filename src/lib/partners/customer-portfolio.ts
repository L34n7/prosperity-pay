import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

export type PartnerType = "affiliate" | "accredited";

export type PartnerCustomer = {
  key: string;
  customerId: string;
  membershipId: string;
  partnerType: PartnerType;
  customerName: string;
  customerEmail: string;
  fullCustomerData: boolean;
  productId: string;
  productName: string;
  offerName: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  currentAmountCents: number;
  nextDueAt: string | null;
  customerSince: string;
  lastPurchaseAt: string;
  paidOrders: number;
  salesVolumeCents: number;
  commissionPendingCents: number;
  commissionAvailableCents: number;
  commissionPaidCents: number;
  commissionTotalCents: number;
};

export type PartnerPortfolio = {
  partnerTypes: PartnerType[];
  customers: PartnerCustomer[];
  summary: {
    totalCustomers: number;
    activeCustomers: number;
    recurringRevenueCents: number;
    salesVolumeCents: number;
    commissionPendingCents: number;
    commissionAvailableCents: number;
    commissionPaidCents: number;
    commissionTotalCents: number;
  };
};

type MembershipInfo = {
  id: string;
  partnerType: PartnerType;
  productId: string;
  productName: string;
  customerDataAccess: boolean;
};

function singleRelation<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function maskedEmail(value: string) {
  const [local = "", domain = ""] = value.split("@");
  if (!domain) return value ? "••••" : "";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${local.length > 2 ? "•••" : "•"}@${domain}`;
}

function asTime(value: string | null | undefined) {
  const time = value ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

export async function getPartnerCustomerPortfolio(options?: {
  partnerType?: PartnerType;
}): Promise<PartnerPortfolio> {
  const { user } = await requireUser();
  const admin = createAdminClient();

  let membershipQuery = admin
    .from("affiliate_memberships")
    .select(
      "id,partner_type,status,created_at,affiliate_programs!inner(product_id,customer_data_access,products(name))",
    )
    .eq("user_id", user.id)
    .eq("status", "active");

  if (options?.partnerType) {
    membershipQuery = membershipQuery.eq("partner_type", options.partnerType);
  }

  const { data: memberships, error: membershipsError } = await membershipQuery;
  if (membershipsError) throw membershipsError;

  const membershipInfos = (memberships ?? []).flatMap((membership) => {
    const program = singleRelation(membership.affiliate_programs);
    if (!program) return [];
    const product = singleRelation(program.products);
    return [{
      id: membership.id,
      partnerType: membership.partner_type as PartnerType,
      productId: program.product_id,
      productName: product?.name ?? "Produto",
      customerDataAccess: Boolean(program.customer_data_access),
    } satisfies MembershipInfo];
  });

  if (!membershipInfos.length) {
    return {
      partnerTypes: [],
      customers: [],
      summary: {
        totalCustomers: 0,
        activeCustomers: 0,
        recurringRevenueCents: 0,
        salesVolumeCents: 0,
        commissionPendingCents: 0,
        commissionAvailableCents: 0,
        commissionPaidCents: 0,
        commissionTotalCents: 0,
      },
    };
  }

  const membershipIds = membershipInfos.map((item) => item.id);
  const membershipMap = new Map(membershipInfos.map((item) => [item.id, item]));

  const [attributionsResult, subscriptionsResult, commissionsResult] = await Promise.all([
    admin
      .from("affiliate_attributions")
      .select("affiliate_membership_id,order_id,attributed_at")
      .in("affiliate_membership_id", membershipIds)
      .not("order_id", "is", null),
    admin
      .from("subscriptions")
      .select(
        "id,affiliate_membership_id,customer_id,product_id,offer_id,status,current_amount_cents,current_period_start,current_period_end,next_due_at,created_at",
      )
      .in("affiliate_membership_id", membershipIds),
    admin
      .from("commissions")
      .select(
        "amount_cents,status,created_at,payments!commissions_payment_id_fkey(order_id)",
      )
      .eq("beneficiary_user_id", user.id),
  ]);

  if (attributionsResult.error || subscriptionsResult.error || commissionsResult.error) {
    throw attributionsResult.error || subscriptionsResult.error || commissionsResult.error;
  }

  const attributions = attributionsResult.data ?? [];
  const subscriptions = subscriptionsResult.data ?? [];
  const attributedOrderIds = unique(
    attributions.map((item) => item.order_id).filter((id): id is string => Boolean(id)),
  );
  const subscriptionIds = subscriptions.map((item) => item.id);

  const [attributedOrdersResult, subscriptionOrdersResult] = await Promise.all([
    attributedOrderIds.length
      ? admin
          .from("orders")
          .select(
            "id,customer_id,product_id,offer_id,subscription_id,status,gross_amount_cents,paid_at,created_at",
          )
          .in("id", attributedOrderIds)
      : Promise.resolve({ data: [], error: null }),
    subscriptionIds.length
      ? admin
          .from("orders")
          .select(
            "id,customer_id,product_id,offer_id,subscription_id,status,gross_amount_cents,paid_at,created_at",
          )
          .in("subscription_id", subscriptionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (attributedOrdersResult.error || subscriptionOrdersResult.error) {
    throw attributedOrdersResult.error || subscriptionOrdersResult.error;
  }

  const orders = Array.from(
    new Map(
      [...(attributedOrdersResult.data ?? []), ...(subscriptionOrdersResult.data ?? [])]
        .map((order) => [order.id, order]),
    ).values(),
  );

  const customerIds = unique([
    ...orders.map((order) => order.customer_id),
    ...subscriptions.map((subscription) => subscription.customer_id),
  ]);
  const offerIds = unique([
    ...orders.map((order) => order.offer_id),
    ...subscriptions.map((subscription) => subscription.offer_id),
  ]);

  const [customersResult, offersResult] = await Promise.all([
    customerIds.length
      ? admin.from("customers").select("id,name,email,created_at").in("id", customerIds)
      : Promise.resolve({ data: [], error: null }),
    offerIds.length
      ? admin.from("offers").select("id,name").in("id", offerIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (customersResult.error || offersResult.error) {
    throw customersResult.error || offersResult.error;
  }

  const customerMap = new Map((customersResult.data ?? []).map((item) => [item.id, item]));
  const offerMap = new Map((offersResult.data ?? []).map((item) => [item.id, item]));
  const attributionMembershipByOrder = new Map(
    attributions
      .filter((item) => item.order_id)
      .map((item) => [item.order_id as string, item.affiliate_membership_id]),
  );
  const membershipBySubscription = new Map(
    subscriptions
      .filter((item) => item.affiliate_membership_id)
      .map((item) => [item.id, item.affiliate_membership_id as string]),
  );

  type MutableCustomer = PartnerCustomer & { _lastOfferAt: number };
  const portfolioMap = new Map<string, MutableCustomer>();
  const orderPortfolioKey = new Map<string, string>();

  function ensureCustomer(params: {
    membershipId: string;
    customerId: string;
    productId: string;
    offerId: string | null;
    when: string;
  }) {
    const membership = membershipMap.get(params.membershipId);
    if (!membership || membership.productId !== params.productId) return null;
    const customer = customerMap.get(params.customerId);
    if (!customer) return null;

    const key = `${params.membershipId}:${params.customerId}:${params.productId}`;
    const current = portfolioMap.get(key);
    const whenTime = asTime(params.when);
    if (current) {
      if (whenTime > current._lastOfferAt && params.offerId) {
        current.offerName = offerMap.get(params.offerId)?.name ?? current.offerName;
        current._lastOfferAt = whenTime;
      }
      return current;
    }

    const rawEmail = customer.email?.endsWith(".invalid") ? "" : customer.email ?? "";
    const createdAt = customer.created_at || params.when;
    const entry: MutableCustomer = {
      key,
      customerId: customer.id,
      membershipId: membership.id,
      partnerType: membership.partnerType,
      customerName: customer.name || (rawEmail ? rawEmail.split("@")[0] : "Cliente"),
      customerEmail: membership.customerDataAccess ? rawEmail : maskedEmail(rawEmail),
      fullCustomerData: membership.customerDataAccess,
      productId: membership.productId,
      productName: membership.productName,
      offerName: params.offerId ? offerMap.get(params.offerId)?.name ?? null : null,
      subscriptionId: null,
      subscriptionStatus: null,
      currentAmountCents: 0,
      nextDueAt: null,
      customerSince: createdAt,
      lastPurchaseAt: params.when,
      paidOrders: 0,
      salesVolumeCents: 0,
      commissionPendingCents: 0,
      commissionAvailableCents: 0,
      commissionPaidCents: 0,
      commissionTotalCents: 0,
      _lastOfferAt: whenTime,
    };
    portfolioMap.set(key, entry);
    return entry;
  }

  for (const subscription of subscriptions) {
    if (!subscription.affiliate_membership_id) continue;
    const entry = ensureCustomer({
      membershipId: subscription.affiliate_membership_id,
      customerId: subscription.customer_id,
      productId: subscription.product_id,
      offerId: subscription.offer_id,
      when: subscription.created_at,
    });
    if (!entry) continue;
    entry.subscriptionId = subscription.id;
    entry.subscriptionStatus = subscription.status;
    entry.currentAmountCents = Number(subscription.current_amount_cents || 0);
    entry.nextDueAt = subscription.next_due_at || subscription.current_period_end;
  }

  for (const order of orders) {
    const membershipId = order.subscription_id
      ? membershipBySubscription.get(order.subscription_id)
      : attributionMembershipByOrder.get(order.id);
    const resolvedMembershipId =
      membershipId ?? attributionMembershipByOrder.get(order.id);
    if (!resolvedMembershipId) continue;

    const entry = ensureCustomer({
      membershipId: resolvedMembershipId,
      customerId: order.customer_id,
      productId: order.product_id,
      offerId: order.offer_id,
      when: order.paid_at || order.created_at,
    });
    if (!entry) continue;

    orderPortfolioKey.set(order.id, entry.key);
    if (order.paid_at) {
      entry.paidOrders += 1;
      entry.salesVolumeCents += Number(order.gross_amount_cents || 0);
      if (asTime(order.paid_at) > asTime(entry.lastPurchaseAt)) {
        entry.lastPurchaseAt = order.paid_at;
      }
      if (asTime(order.paid_at) < asTime(entry.customerSince)) {
        entry.customerSince = order.paid_at;
      }
    }
  }

  for (const commission of commissionsResult.data ?? []) {
    const payment = singleRelation(commission.payments);
    const orderId = payment?.order_id;
    if (!orderId) continue;
    const key = orderPortfolioKey.get(orderId);
    if (!key) continue;
    const entry = portfolioMap.get(key);
    if (!entry) continue;
    const amount = Number(commission.amount_cents || 0);
    entry.commissionTotalCents += amount;
    if (commission.status === "pending") entry.commissionPendingCents += amount;
    if (commission.status === "available") entry.commissionAvailableCents += amount;
    if (commission.status === "paid") entry.commissionPaidCents += amount;
  }

  const customers = Array.from(portfolioMap.values())
    .map(({ _lastOfferAt: _ignored, ...customer }) => customer)
    .sort((a, b) => asTime(b.lastPurchaseAt) - asTime(a.lastPurchaseAt));

  const summary = customers.reduce(
    (acc, customer) => {
      acc.totalCustomers += 1;
      if (customer.subscriptionStatus === "active") {
        acc.activeCustomers += 1;
        acc.recurringRevenueCents += customer.currentAmountCents;
      }
      acc.salesVolumeCents += customer.salesVolumeCents;
      acc.commissionPendingCents += customer.commissionPendingCents;
      acc.commissionAvailableCents += customer.commissionAvailableCents;
      acc.commissionPaidCents += customer.commissionPaidCents;
      acc.commissionTotalCents += customer.commissionTotalCents;
      return acc;
    },
    {
      totalCustomers: 0,
      activeCustomers: 0,
      recurringRevenueCents: 0,
      salesVolumeCents: 0,
      commissionPendingCents: 0,
      commissionAvailableCents: 0,
      commissionPaidCents: 0,
      commissionTotalCents: 0,
    },
  );

  return {
    partnerTypes: unique(membershipInfos.map((item) => item.partnerType)),
    customers,
    summary,
  };
}
