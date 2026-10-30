import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

const TZ = "America/Sao_Paulo";
const PAGE_SIZE = 500;
const BATCH_SIZE = 150;

type JsonRow = Record<string, unknown>;
type CommissionStatus = "pending" | "available" | "paid" | "reversed" | "cancelled";

export type AccreditedSale = {
  id: string;
  orderNumber: number;
  paidAt: string;
  product: string;
  customer: string;
  customerEmail: string;
  grossCents: number;
  commissionCents: number;
  commissionStatus: string;
};

export type AccreditedProducerPartner = {
  id: string;
  name: string;
  email: string;
  codes: string[];
  products: string[];
  since: string;
  status: string;
  sales: AccreditedSale[];
  salesCount: number;
  customersCount: number;
  grossCents: number;
  generatedCents: number;
  paidCents: number;
  availableCents: number;
  pendingCents: number;
  lastSale: string | null;
};

export type AccreditedProducerReport = {
  month: string;
  monthLabel: string;
  products: { id: string; name: string }[];
  productId: string;
  partners: AccreditedProducerPartner[];
  totals: {
    partners: number;
    active: number;
    selling: number;
    sales: number;
    customers: number;
    grossCents: number;
    generatedCents: number;
    paidCents: number;
    availableCents: number;
    pendingCents: number;
  };
};

function chunks<T>(items: T[], length = BATCH_SIZE): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += length) result.push(items.slice(i, i + length));
  return result;
}

function currentMonth() {
  const pieces = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit",
  }).formatToParts(new Date());
  return `${pieces.find((item) => item.type === "year")?.value}-${pieces.find((item) => item.type === "month")?.value}`;
}

function monthRange(month: string) {
  const parsed = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!parsed || Number(parsed[1]) < 2020 || Number(parsed[1]) > 2100) {
    month = currentMonth();
  }
  const [year, part] = month.split("-").map(Number);
  // Sao Paulo has been on UTC-03 without daylight-saving time since 2019.
  const start = new Date(Date.UTC(year, part - 1, 1, 3, 0, 0));
  const end = new Date(Date.UTC(year, part, 1, 3, 0, 0));
  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    timeZone: TZ, month: "long", year: "numeric",
  }).format(new Date(Date.UTC(year, part - 1, 15, 12)));
  return { month, monthLabel, start: start.toISOString(), end: end.toISOString() };
}

function amount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeDate(value: unknown) {
  return typeof value === "string" ? value : null;
}

async function getAllRows<T extends JsonRow>(
  query: (start: number, end: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const all: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await query(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return all;
}

export async function getProducerAccreditedReport(input: { month?: string; productId?: string } = {}) {
  const { user } = await requireUser();
  const admin = createAdminClient();
  const period = monthRange(input.month ?? currentMonth());

  // Always resolve owned products from the authenticated user; never trust a
  // producer id or product id supplied in a URL for service-role queries.
  const products = await getAllRows((start, end) =>
    admin.from("products").select("id,name")
      .eq("producer_id", user.id).order("name").range(start, end),
  );
  if (!products.length) return null;
  const productId = input.productId && products.some((p) => p.id === input.productId)
    ? input.productId : "all";
  const selected = productId === "all" ? products : products.filter((p) => p.id === productId);
  const ids = selected.map((p) => String(p.id));
  const productName = new Map(products.map((p) => [String(p.id), String(p.name || "Produto")]));

  const programs = await getAllRows((start, end) =>
    admin.from("affiliate_programs")
      .select("id,product_id").in("product_id", ids)
      .order("created_at").range(start, end),
  );
  const programIds = programs.map((p) => String(p.id));
  const programProduct = new Map(programs.map((p) => [String(p.id), String(p.product_id)]));

  const memberships: Array<{
    id: string; user_id: string; program_id: string; code: string;
    status: string; created_at: string;
  }> = [];
  for (const batch of chunks(programIds)) {
    const rows = await getAllRows((start, end) =>
      admin.from("affiliate_memberships")
        .select("id,user_id,program_id,code,status,created_at")
        .in("program_id", batch).eq("partner_type", "accredited")
        .order("created_at").range(start, end),
    );
    memberships.push(...rows);
  }

  const partnerUserIds = Array.from(new Set(memberships.map((m) => m.user_id)));
  const profiles: Array<{ id: string; full_name: string | null; email: string | null }> = [];
  for (const batch of chunks(partnerUserIds)) {
    const { data, error } = await admin.from("profiles")
      .select("id,full_name,email").in("id", batch);
    if (error) throw error;
    profiles.push(...(data ?? []));
  }
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const membershipById = new Map(memberships.map((m) => [m.id, m]));
  const membershipByUserProduct = new Map(
    memberships.map((m) => [`${m.user_id}:${programProduct.get(m.program_id)}`, m]),
  );

  const partnersMap = new Map<string, AccreditedProducerPartner>();
  for (const membership of memberships) {
    const profile = profileById.get(membership.user_id);
    const product = productName.get(programProduct.get(membership.program_id) ?? "") ?? "Produto";
    let partner = partnersMap.get(membership.user_id);
    if (!partner) {
      partner = {
        id: membership.user_id,
        name: profile?.full_name || profile?.email || "Credenciado",
        email: profile?.email || "E-mail não informado",
        codes: [], products: [], since: membership.created_at,
        status: membership.status, sales: [], salesCount: 0, customersCount: 0,
        grossCents: 0, generatedCents: 0, paidCents: 0, availableCents: 0,
        pendingCents: 0, lastSale: null,
      };
      partnersMap.set(membership.user_id, partner);
    }
    if (!partner.codes.includes(membership.code)) partner.codes.push(membership.code);
    if (!partner.products.includes(product)) partner.products.push(product);
    if (membership.created_at < partner.since) partner.since = membership.created_at;
    if (membership.status === "active") partner.status = "active";
  }

  const orders: Array<{
    id: string; order_number: number; product_id: string; customer_id: string;
    paid_at: string; gross_amount_cents: number;
  }> = [];
  for (const batch of chunks(ids)) {
    const rows = await getAllRows((start, end) =>
      admin.from("orders")
        .select("id,order_number,product_id,customer_id,paid_at,gross_amount_cents")
        .eq("producer_id", user.id).in("product_id", batch)
        .eq("status", "paid")
        .gte("paid_at", period.start).lt("paid_at", period.end)
        .order("paid_at", { ascending: false }).order("id")
        .range(start, end),
    );
    orders.push(...rows);
  }

  const customerIds = Array.from(new Set(orders.map((o) => o.customer_id).filter(Boolean)));
  const customerById = new Map<string, { name: string; email: string }>();
  for (const batch of chunks(customerIds)) {
    const { data, error } = await admin.from("customers").select("id,name,email").in("id", batch);
    if (error) throw error;
    for (const row of data ?? []) {
      customerById.set(row.id, { name: row.name || "Cliente", email: row.email || "—" });
    }
  }

  const paidPaymentByOrder = new Map<string, string>();
  const attributionByOrder = new Map<string, string>();
  const commissionByOrder = new Map<string, {
    memberId: string; amountCents: number; status: CommissionStatus; availableAt: string | null;
  }[]>();

  for (const batch of chunks(orders.map((o) => o.id))) {
    const [paymentResult, attributionResult] = await Promise.all([
      admin.from("payments")
        .select("id,order_id,status,paid_at").in("order_id", batch).eq("status", "approved"),
      admin.from("affiliate_attributions")
        .select("order_id,affiliate_membership_id,attributed_at")
        .in("order_id", batch).order("attributed_at", { ascending: false }),
    ]);
    if (paymentResult.error) throw paymentResult.error;
    if (attributionResult.error) throw attributionResult.error;
    for (const payment of paymentResult.data ?? []) {
      if (!paidPaymentByOrder.has(payment.order_id)) paidPaymentByOrder.set(payment.order_id, payment.id);
    }
    for (const a of attributionResult.data ?? []) {
      if (a.affiliate_membership_id && membershipById.has(a.affiliate_membership_id)
        && !attributionByOrder.has(a.order_id)) {
        attributionByOrder.set(a.order_id, a.affiliate_membership_id);
      }
    }
  }

  const orderIdByPayment = new Map(Array.from(paidPaymentByOrder.entries()).map(([orderId,paymentId])=>[paymentId,orderId]));
  for (const batch of chunks(Array.from(orderIdByPayment.keys()))) {
    const { data, error } = await admin.from("commissions")
      .select("id,payment_id,beneficiary_user_id,commission_type,status,amount_cents,available_at")
      .in("payment_id", batch).in("commission_type", ["accredited", "affiliate"]);
    if (error) throw error;
    for (const c of data ?? []) {
      const orderId = orderIdByPayment.get(c.payment_id);
      const order = orders.find((o) => o.id === orderId);
      if (!order) continue;
      const membership = membershipByUserProduct.get(`${c.beneficiary_user_id}:${order.product_id}`);
      if (!membership) continue;
      const existing = commissionByOrder.get(order.id) ?? [];
      existing.push({
        memberId: membership.id,
        amountCents: amount(c.amount_cents),
        status: c.status as CommissionStatus,
        availableAt: c.available_at,
      });
      commissionByOrder.set(order.id, existing);
    }
  }

  const now = Date.now();
  const customersPerPartner = new Map<string, Set<string>>();
  for (const order of orders) {
    // A paid order must also have a confirmed gateway/manual payment.
    if (!paidPaymentByOrder.has(order.id)) continue;
    const commissions = commissionByOrder.get(order.id) ?? [];
    const membershipId = attributionByOrder.get(order.id) ?? commissions[0]?.memberId;
    const membership = membershipId ? membershipById.get(membershipId) : null;
    if (!membership || programProduct.get(membership.program_id) !== order.product_id) continue;
    const partner = partnersMap.get(membership.user_id);
    if (!partner) continue;

    const validCommissions = commissions.filter((c) =>
      c.memberId === membership.id && c.status !== "cancelled" && c.status !== "reversed");
    const commissionCents = validCommissions.reduce((sum, c) => sum + c.amountCents, 0);
    let saleStatus = "Sem comissão";
    for (const c of validCommissions) {
      partner.generatedCents += c.amountCents;
      if (c.status === "paid") {
        partner.paidCents += c.amountCents;
        saleStatus = "Pago";
      } else if (c.status === "available" || (c.status === "pending" && c.availableAt && new Date(c.availableAt).getTime() <= now)) {
        partner.availableCents += c.amountCents;
        saleStatus = "Disponível";
      } else {
        partner.pendingCents += c.amountCents;
        saleStatus = "Em retenção";
      }
    }

    partner.salesCount++;
    partner.grossCents += amount(order.gross_amount_cents);
    const saleDate = safeDate(order.paid_at) ?? "";
    if (!partner.lastSale || saleDate > partner.lastSale) partner.lastSale = saleDate;
    if (order.customer_id) {
      const set = customersPerPartner.get(partner.id) ?? new Set<string>();
      set.add(order.customer_id);
      customersPerPartner.set(partner.id, set);
    }
    const customer = customerById.get(order.customer_id);
    partner.sales.push({
      id: order.id, orderNumber: order.order_number,
      paidAt: saleDate,
      product: productName.get(order.product_id) ?? "Produto",
      customer: customer?.name ?? "Cliente", customerEmail: customer?.email ?? "—",
      grossCents: amount(order.gross_amount_cents),
      commissionCents, commissionStatus: saleStatus,
    });
  }

  const partners = Array.from(partnersMap.values())
    .map((partner) => ({
      ...partner,
      customersCount: customersPerPartner.get(partner.id)?.size ?? 0,
      sales: partner.sales.sort((a, b) => b.paidAt.localeCompare(a.paidAt)),
    }))
    .sort((a,b) => b.grossCents - a.grossCents || a.name.localeCompare(b.name));

  return {
    month: period.month,
    monthLabel: period.monthLabel,
    products: products.map((p) => ({ id: String(p.id), name: String(p.name ?? "Produto") })),
    productId,
    partners,
    totals: {
      partners: partners.length,
      active: partners.filter((p) => p.status === "active").length,
      selling: partners.filter((p) => p.salesCount > 0).length,
      sales: partners.reduce((sum,p) => sum+p.salesCount,0),
      customers: new Set(partners.flatMap((p) => p.sales.map((s) => s.customerEmail.toLowerCase()))).size,
      grossCents: partners.reduce((sum,p) => sum+p.grossCents,0),
      generatedCents: partners.reduce((sum,p) => sum+p.generatedCents,0),
      paidCents: partners.reduce((sum,p) => sum+p.paidCents,0),
      availableCents: partners.reduce((sum,p) => sum+p.availableCents,0),
      pendingCents: partners.reduce((sum,p) => sum+p.pendingCents,0),
    },
  } satisfies AccreditedProducerReport;
}
