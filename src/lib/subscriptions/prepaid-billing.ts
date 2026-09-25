import { randomBytes } from "node:crypto";
import { HttpError } from "@/lib/api/http";
import { PROSPERITY_PAY_ORIGIN } from "@/lib/domain/offer-reference";
import { sha256 } from "@/lib/security/hash";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json } from "@/lib/supabase/database.types";

type AdminClient = ReturnType<typeof createAdminClient>;

export type SubscriptionAction =
  | { type: "change_plan"; offerReference: string }
  | { type: "add_addon"; addonCode: string; quantity?: number }
  | { type: "remove_addon"; addonCode: string; quantity?: number }
  | { type: "cancel_scheduled_plan_change"; changeId?: string }
  | { type: "renew" };

type LoadedSubscription = {
  id: string;
  product_id: string;
  customer_id: string;
  offer_id: string;
  order_id: string;
  status: string;
  billing_model: string;
  currency: string;
  base_amount_cents: number;
  current_amount_cents: number;
  current_period_start: string | null;
  current_period_end: string | null;
  cycle_number: number;
  affiliate_membership_id: string | null;
};

type ActiveItem = {
  id: string;
  item_type: "base" | "addon";
  offer_id: string | null;
  addon_id: string | null;
  code: string;
  description: string;
  unit_amount_cents: number;
  quantity: number;
};

type InvoiceLine = {
  lineType: "base" | "addon" | "proration";
  itemCode: string;
  description: string;
  unitAmountCents: number;
  quantity: number;
  totalAmountCents: number;
  commissionableAmountCents: number;
  metadata?: Record<string, Json | undefined>;
};

function positiveQuantity(value: number | undefined) {
  const quantity = value ?? 1;
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 10_000) {
    throw new HttpError(400, "Quantidade inválida.");
  }
  return quantity;
}

function calculateProration(deltaCents: number, startIso: string | null, endIso: string | null) {
  if (deltaCents <= 0) return 0;
  if (!startIso || !endIso) throw new HttpError(409, "Assinatura sem ciclo financeiro ativo.");
  const now = Date.now();
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new HttpError(409, "Ciclo financeiro da assinatura inválido.");
  }
  if (now >= end) return 0;
  const remaining = Math.max(0, end - Math.max(now, start));
  return Math.max(1, Math.round(deltaCents * (remaining / (end - start))));
}

async function loadSubscription(admin: AdminClient, subscriptionId: string) {
  const { data, error } = await admin.from("subscriptions")
    .select("id,product_id,customer_id,offer_id,order_id,status,billing_model,currency,base_amount_cents,current_amount_cents,current_period_start,current_period_end,cycle_number,affiliate_membership_id")
    .eq("id", subscriptionId)
    .single();
  if (error || !data) throw new HttpError(404, "Assinatura não encontrada.");
  const subscription = data as LoadedSubscription;
  if (subscription.billing_model !== "prepaid") throw new HttpError(409, "Esta assinatura não usa o modelo pré-pago.");
  if (!["active", "past_due"].includes(subscription.status)) throw new HttpError(409, "Assinatura indisponível para alteração.");
  return subscription;
}

async function activeItems(admin: AdminClient, subscriptionId: string) {
  const { data, error } = await admin.from("subscription_items")
    .select("id,item_type,offer_id,addon_id,code,description,unit_amount_cents,quantity")
    .eq("subscription_id", subscriptionId)
    .eq("status", "active")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ActiveItem[];
}

async function affiliatePolicy(admin: AdminClient, productId: string) {
  const { data, error } = await admin.from("affiliate_programs")
    .select("active,commission_addons,commission_prorated_changes")
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw error;
  return {
    active: Boolean(data?.active),
    commissionAddons: Boolean(data?.commission_addons),
    commissionProratedChanges: Boolean(data?.commission_prorated_changes),
  };
}

async function newSession(input: {
  admin: AdminClient;
  subscriptionId: string;
  changeId?: string;
  sessionType: "subscription_change" | "subscription_renewal";
  amountCents: number;
  currency: string;
  metadata: Json;
  expiresAt: Date;
}) {
  const token = randomBytes(32).toString("base64url");
  const { error } = await input.admin.from("subscription_checkout_sessions").insert({
    token_hash: sha256(token),
    subscription_id: input.subscriptionId,
    subscription_change_id: input.changeId ?? null,
    session_type: input.sessionType,
    amount_cents: input.amountCents,
    currency: input.currency,
    expires_at: input.expiresAt.toISOString(),
    metadata: input.metadata,
  });
  if (error) throw error;
  return {
    checkoutUrl: `${PROSPERITY_PAY_ORIGIN}/assinatura/checkout/${token}`,
    expiresAt: input.expiresAt.toISOString(),
  };
}

function quoteExpiry(periodEnd: string) {
  const max = Date.now() + 30 * 60 * 1000;
  const end = new Date(periodEnd).getTime();
  return new Date(Math.min(max, end));
}

async function immediateSession(input: {
  admin: AdminClient;
  subscription: LoadedSubscription;
  changeId: string;
  amountCents: number;
  commissionableAmountCents: number;
  description: string;
  itemCode: string;
  targetOfferId?: string;
}) {
  if (!input.subscription.current_period_end) throw new HttpError(409, "Assinatura sem vencimento definido.");
  const expiresAt = quoteExpiry(input.subscription.current_period_end);
  if (expiresAt.getTime() <= Date.now()) throw new HttpError(409, "O ciclo atual encerrou. Gere a renovação antes de alterar a assinatura.");

  const line: InvoiceLine = {
    lineType: "proration",
    itemCode: input.itemCode,
    description: input.description,
    unitAmountCents: input.amountCents,
    quantity: 1,
    totalAmountCents: input.amountCents,
    commissionableAmountCents: input.commissionableAmountCents,
    metadata: { subscriptionChangeId: input.changeId },
  };

  const session = await newSession({
    admin: input.admin,
    subscriptionId: input.subscription.id,
    changeId: input.changeId,
    sessionType: "subscription_change",
    amountCents: input.amountCents,
    currency: input.subscription.currency,
    expiresAt,
    metadata: {
      lines: [line],
      affiliateBaseAmountCents: input.commissionableAmountCents,
      targetOfferId: input.targetOfferId ?? input.subscription.offer_id,
      billingReason: "subscription_change",
    } as unknown as Json,
  });

  return {
    status: "awaiting_payment" as const,
    subscriptionId: input.subscription.id,
    changeId: input.changeId,
    amountCents: input.amountCents,
    currency: input.subscription.currency,
    ...session,
  };
}

async function createPlanChange(admin: AdminClient, subscription: LoadedSubscription, offerReference: string) {
  const { data: target, error } = await admin.from("offers")
    .select("id,name,checkout_slug,price_cents,currency,billing_type,status,product_id")
    .eq("product_id", subscription.product_id)
    .eq("checkout_slug", offerReference.toLowerCase())
    .eq("status", "active")
    .single();
  if (error || !target) throw new HttpError(404, "Plano/oferta de destino não encontrado.");
  if (target.billing_type !== "recurring") throw new HttpError(409, "A oferta de destino não é uma assinatura.");
  if (target.currency !== subscription.currency) throw new HttpError(409, "A moeda da oferta é incompatível com a assinatura.");

  const items = await activeItems(admin, subscription.id);
  const addonsTotal = items.filter(item => item.item_type === "addon")
    .reduce((sum, item) => sum + Number(item.unit_amount_cents) * Number(item.quantity), 0);
  const targetBase = Number(target.price_cents);
  const targetTotal = targetBase + addonsTotal;
  const currentTotal = Number(subscription.current_amount_cents);
  if (targetTotal === currentTotal && target.id === subscription.offer_id) {
    throw new HttpError(409, "A assinatura já está neste plano.");
  }

  const increase = targetTotal > currentTotal;
  const proration = increase
    ? calculateProration(targetTotal - currentTotal, subscription.current_period_start, subscription.current_period_end)
    : 0;
  const policy = await affiliatePolicy(admin, subscription.product_id);
  const immediate = increase && proration > 0;
  const status = immediate ? "awaiting_payment" : "scheduled";
  const effectiveMode = immediate ? "immediately_after_payment" : "next_period_after_payment";
  const metadata = {
    targetCode: target.checkout_slug,
    targetDescription: target.name,
    targetUnitAmountCents: targetBase,
  };

  const { data: change, error: changeError } = await admin.from("subscription_changes").insert({
    subscription_id: subscription.id,
    change_type: increase ? "upgrade" : "downgrade",
    status,
    from_offer_id: subscription.offer_id,
    to_offer_id: target.id,
    base_amount_before_cents: subscription.base_amount_cents,
    base_amount_after_cents: targetBase,
    current_amount_cents: currentTotal,
    quoted_target_amount_cents: targetTotal,
    proration_amount_cents: proration,
    commissionable_amount_cents: immediate && policy.commissionProratedChanges ? proration : 0,
    effective_mode: effectiveMode,
    effective_at: immediate ? null : subscription.current_period_end,
    quote_expires_at: immediate && subscription.current_period_end
      ? quoteExpiry(subscription.current_period_end).toISOString()
      : null,
    metadata,
  }).select("id").single();
  if (changeError || !change) throw changeError ?? new Error("Falha ao registrar alteração.");

  if (!immediate) {
    return {
      status: "scheduled" as const,
      subscriptionId: subscription.id,
      changeId: change.id,
      amountCents: 0,
      currency: subscription.currency,
      effectiveAt: subscription.current_period_end,
      targetAmountCents: targetTotal,
    };
  }

  return immediateSession({
    admin,
    subscription,
    changeId: change.id,
    amountCents: proration,
    commissionableAmountCents: policy.commissionProratedChanges ? proration : 0,
    description: `Ajuste proporcional: ${target.name}`,
    itemCode: target.checkout_slug,
    targetOfferId: target.id,
  });
}

async function createAddonChange(
  admin: AdminClient,
  subscription: LoadedSubscription,
  addonCode: string,
  direction: "add" | "remove",
  requestedQuantity?: number,
) {
  const quantity = positiveQuantity(requestedQuantity);
  const { data: addon, error } = await admin.from("product_addons")
    .select("id,code,name,unit_amount_cents,currency,max_quantity,active")
    .eq("product_id", subscription.product_id)
    .eq("code", addonCode)
    .single();
  if (error || !addon) throw new HttpError(404, "Adicional não encontrado.");
  if (!addon.active && direction === "add") throw new HttpError(409, "Este adicional está inativo.");
  if (addon.currency !== subscription.currency) throw new HttpError(409, "A moeda do adicional é incompatível com a assinatura.");

  const items = await activeItems(admin, subscription.id);
  const current = items.find(item => item.addon_id === addon.id);
  const before = Number(current?.quantity ?? 0);
  const delta = direction === "add" ? quantity : -quantity;
  const after = before + delta;
  if (after < 0) throw new HttpError(409, "Quantidade a remover maior que a contratada.");
  if (after === before) throw new HttpError(409, "Nenhuma alteração de quantidade.");
  if (addon.max_quantity != null && after > Number(addon.max_quantity)) {
    throw new HttpError(409, `Quantidade máxima deste adicional: ${addon.max_quantity}.`);
  }

  // Uma vez contratado, o preço unitário do adicional fica congelado para
  // aquela assinatura, inclusive quando a quantidade é aumentada depois.
  const unit = Number(current?.unit_amount_cents ?? addon.unit_amount_cents);
  const targetTotal = Number(subscription.current_amount_cents) + delta * unit;
  if (targetTotal <= 0) throw new HttpError(409, "A composição da assinatura ficaria inválida.");
  const increase = delta > 0;
  const proration = increase
    ? calculateProration(delta * unit, subscription.current_period_start, subscription.current_period_end)
    : 0;
  const policy = await affiliatePolicy(admin, subscription.product_id);
  const immediate = increase && proration > 0;

  const changeType = increase
    ? (before === 0 ? "add_item" : "increase_quantity")
    : (after === 0 ? "remove_item" : "decrease_quantity");

  const { data: change, error: changeError } = await admin.from("subscription_changes").insert({
    subscription_id: subscription.id,
    change_type: changeType,
    status: immediate ? "awaiting_payment" : "scheduled",
    addon_id: addon.id,
    quantity_delta: delta,
    quantity_before: before,
    quantity_after: after,
    current_amount_cents: subscription.current_amount_cents,
    quoted_target_amount_cents: targetTotal,
    proration_amount_cents: proration,
    commissionable_amount_cents: immediate && policy.commissionProratedChanges ? proration : 0,
    effective_mode: immediate ? "immediately_after_payment" : "next_period_after_payment",
    effective_at: immediate ? null : subscription.current_period_end,
    quote_expires_at: immediate && subscription.current_period_end
      ? quoteExpiry(subscription.current_period_end).toISOString()
      : null,
    metadata: {
      targetCode: addon.code,
      targetDescription: addon.name,
      targetUnitAmountCents: unit,
    },
  }).select("id").single();
  if (changeError || !change) throw changeError ?? new Error("Falha ao registrar alteração.");

  if (!immediate) {
    return {
      status: "scheduled" as const,
      subscriptionId: subscription.id,
      changeId: change.id,
      amountCents: 0,
      currency: subscription.currency,
      effectiveAt: subscription.current_period_end,
      targetAmountCents: targetTotal,
    };
  }

  return immediateSession({
    admin,
    subscription,
    changeId: change.id,
    amountCents: proration,
    commissionableAmountCents: policy.commissionProratedChanges ? proration : 0,
    description: `Ajuste proporcional: ${addon.name} × ${quantity}`,
    itemCode: addon.code,
  });
}

type ProjectedAddon = {
  id: string;
  code: string;
  description: string;
  unitAmountCents: number;
  quantity: number;
};

async function cancelScheduledPlanChange(
  admin: AdminClient,
  subscription: LoadedSubscription,
  changeId?: string,
) {
  let query = admin
    .from("subscription_changes")
    .select("id")
    .eq("subscription_id", subscription.id)
    .eq("status", "scheduled")
    .not("to_offer_id", "is", null)
    .order("created_at", { ascending: false });

  if (changeId) {
    query = query.eq("id", changeId);
  }

  const { data: changes, error: changesError } = await query;
  if (changesError) throw changesError;

  const ids = (changes ?? []).map((item) => item.id).filter(Boolean);
  if (ids.length === 0) {
    throw new HttpError(409, "Não há alteração de plano agendada para cancelar.");
  }

  const { error: cancelError } = await admin
    .from("subscription_changes")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
    })
    .in("id", ids)
    .eq("subscription_id", subscription.id)
    .eq("status", "scheduled");

  if (cancelError) throw cancelError;

  return {
    status: "cancelled" as const,
    subscriptionId: subscription.id,
    changeId: ids[0],
    amountCents: 0,
    targetAmountCents: Number(subscription.current_amount_cents),
    currency: subscription.currency,
  };
}

async function createRenewal(admin: AdminClient, subscription: LoadedSubscription) {
  if (!subscription.current_period_end) throw new HttpError(409, "Assinatura sem vencimento definido.");

  const now = Date.now();
  const periodStartMs = subscription.current_period_start
    ? new Date(subscription.current_period_start).getTime()
    : Number.NaN;
  const periodEndMs = new Date(subscription.current_period_end).getTime();

  if (!Number.isFinite(periodEndMs)) {
    throw new HttpError(409, "Vencimento da assinatura inválido.");
  }

  // Quando o início do ciclo já está no futuro, a próxima mensalidade foi
  // quitada antecipadamente. Limitamos o adiantamento a um único ciclo.
  if (Number.isFinite(periodStartMs) && periodStartMs > now + 60_000) {
    throw new HttpError(409, "A próxima mensalidade já está paga antecipadamente.");
  }

  const payingAhead = now < periodEndMs;

  const { data: renewalInProgress, error: renewalInProgressError } = await admin
    .from("subscription_checkout_sessions")
    .select("id,order_id")
    .eq("subscription_id", subscription.id)
    .eq("session_type", "subscription_renewal")
    .is("consumed_at", null)
    .not("order_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (renewalInProgressError) throw renewalInProgressError;
  if (renewalInProgress?.order_id) {
    throw new HttpError(409, "Já existe um pagamento de renovação aguardando conclusão.");
  }

  const items = await activeItems(admin, subscription.id);
  const base = items.find(item => item.item_type === "base");
  if (!base) throw new HttpError(409, "Item base da assinatura não encontrado.");

  let targetOfferId = base.offer_id ?? subscription.offer_id;
  let baseCode = base.code;
  let baseDescription = base.description;
  let baseAmount = Number(base.unit_amount_cents);
  const addons = new Map<string, ProjectedAddon>();
  const activeAddonItems = items.filter(
    item => item.item_type === "addon" && item.addon_id
  );
  const activeAddonIds = activeAddonItems
    .map(item => item.addon_id!)
    .filter(Boolean);

  const catalogNames = new Map<string, string>();
  if (activeAddonIds.length > 0) {
    const { data: catalogAddons, error: catalogAddonsError } = await admin
      .from("product_addons")
      .select("id,name")
      .in("id", activeAddonIds);

    if (catalogAddonsError) throw catalogAddonsError;

    for (const addon of catalogAddons ?? []) {
      catalogNames.set(addon.id, addon.name);
    }
  }

  for (const item of activeAddonItems) {
    addons.set(item.addon_id!, {
      id: item.addon_id!,
      code: item.code,
      description:
        catalogNames.get(item.addon_id!) ||
        item.description,
      unitAmountCents: Number(item.unit_amount_cents),
      quantity: Number(item.quantity),
    });
  }

  const { data: scheduled, error: scheduledError } = await admin.from("subscription_changes")
    .select("id,change_type,to_offer_id,addon_id,quantity_delta,base_amount_after_cents,metadata")
    .eq("subscription_id", subscription.id)
    .eq("status", "scheduled")
    .eq("effective_mode", "next_period_after_payment")
    .order("created_at");
  if (scheduledError) throw scheduledError;

  // Reduções/downgrades agendados precisam entrar em vigor somente na virada
  // real do ciclo. Para não remover recursos antes da data combinada, o
  // pagamento antecipado fica indisponível enquanto houver mudança agendada.
  if (payingAhead && (scheduled?.length ?? 0) > 0) {
    throw new HttpError(
      409,
      "Há uma alteração agendada para a próxima renovação. O pagamento antecipado ficará disponível quando esse ciclo iniciar.",
    );
  }

  for (const change of scheduled ?? []) {
    const metadata = (change.metadata ?? {}) as Record<string, Json | undefined>;
    if (change.to_offer_id) {
      targetOfferId = change.to_offer_id;
      baseAmount = Number(change.base_amount_after_cents ?? baseAmount);
      baseCode = typeof metadata.targetCode === "string" ? metadata.targetCode : baseCode;
      baseDescription = typeof metadata.targetDescription === "string" ? metadata.targetDescription : baseDescription;
    }
    if (change.addon_id && change.quantity_delta) {
      let projected = addons.get(change.addon_id);
      if (!projected) {
        const { data: catalog } = await admin.from("product_addons")
          .select("id,code,name,unit_amount_cents")
          .eq("id", change.addon_id)
          .single();
        if (!catalog) throw new HttpError(409, "Adicional agendado não encontrado.");
        projected = {
          id: catalog.id,
          code: catalog.code,
          description: catalog.name,
          unitAmountCents: Number(catalog.unit_amount_cents),
          quantity: 0,
        };
      }
      projected.quantity += Number(change.quantity_delta);
      if (projected.quantity <= 0) addons.delete(change.addon_id);
      else addons.set(change.addon_id, projected);
    }
  }

  const policy = await affiliatePolicy(admin, subscription.product_id);
  const lines: InvoiceLine[] = [{
    lineType: "base",
    itemCode: baseCode,
    description: baseDescription,
    unitAmountCents: baseAmount,
    quantity: 1,
    totalAmountCents: baseAmount,
    commissionableAmountCents: baseAmount,
  }];
  for (const addon of addons.values()) {
    const total = addon.unitAmountCents * addon.quantity;
    lines.push({
      lineType: "addon",
      itemCode: addon.code,
      description: addon.description,
      unitAmountCents: addon.unitAmountCents,
      quantity: addon.quantity,
      totalAmountCents: total,
      commissionableAmountCents: policy.commissionAddons ? total : 0,
      metadata: { addonId: addon.id },
    });
  }

  const amountCents = lines.reduce((sum, line) => sum + line.totalAmountCents, 0);
  const affiliateBaseAmountCents = lines.reduce((sum, line) => sum + line.commissionableAmountCents, 0);
  if (amountCents <= 0) throw new HttpError(409, "Valor de renovação inválido.");

  await admin.from("subscription_checkout_sessions")
    .update({ expires_at: new Date().toISOString() })
    .eq("subscription_id", subscription.id)
    .eq("session_type", "subscription_renewal")
    .is("consumed_at", null);

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const session = await newSession({
    admin,
    subscriptionId: subscription.id,
    sessionType: "subscription_renewal",
    amountCents,
    currency: subscription.currency,
    expiresAt,
    metadata: {
      lines,
      affiliateBaseAmountCents,
      targetOfferId,
      billingReason: "subscription_renewal",
    } as unknown as Json,
  });

  return {
    status: "awaiting_payment" as const,
    subscriptionId: subscription.id,
    amountCents,
    targetAmountCents: amountCents,
    currency: subscription.currency,
    ...session,
  };
}

async function expireAbandonedSubscriptionChanges(
  admin: AdminClient,
  subscriptionId: string,
) {
  const nowIso = new Date().toISOString();

  const { data: candidates, error: candidatesError } = await admin
    .from("subscription_changes")
    .select("id,status,quote_expires_at,payment_order_id")
    .eq("subscription_id", subscriptionId)
    .eq("status", "awaiting_payment");

  if (candidatesError) throw candidatesError;

  const staleIds = (candidates ?? [])
    .filter((change) => {
      if (change.payment_order_id) return false;
      if (!change.quote_expires_at) return false;
      const expiresAt = new Date(change.quote_expires_at).getTime();
      return Number.isFinite(expiresAt) && expiresAt <= Date.now();
    })
    .map((change) => change.id);

  if (staleIds.length === 0) return;

  const { error: sessionExpireError } = await admin
    .from("subscription_checkout_sessions")
    .update({ expires_at: nowIso })
    .in("subscription_change_id", staleIds)
    .is("consumed_at", null);

  if (sessionExpireError) throw sessionExpireError;

  const { error: changesExpireError } = await admin
    .from("subscription_changes")
    .update({ status: "expired" })
    .in("id", staleIds)
    .eq("subscription_id", subscriptionId)
    .eq("status", "awaiting_payment");

  if (changesExpireError) throw changesExpireError;
}

export async function createPrepaidSubscriptionIntent(input: {
  subscriptionId: string;
  action: SubscriptionAction;
}) {
  const admin = createAdminClient();
  const subscription = await loadSubscription(admin, input.subscriptionId);

  await expireAbandonedSubscriptionChanges(admin, subscription.id);

  if (input.action.type === "renew") {
    return createRenewal(admin, subscription);
  }

  if (input.action.type === "cancel_scheduled_plan_change") {
    return cancelScheduledPlanChange(
      admin,
      subscription,
      input.action.changeId,
    );
  }

  const { data: openChange, error: openChangeError } = await admin.from("subscription_changes")
    .select("id,status")
    .eq("subscription_id", subscription.id)
    .in("status", ["awaiting_payment", "payment_approved", "applying"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openChangeError) throw openChangeError;
  if (openChange) {
    throw new HttpError(409, "Já existe uma alteração desta assinatura aguardando conclusão do pagamento.");
  }

  if (subscription.status !== "active") {
    throw new HttpError(409, "Somente assinaturas ativas podem ser alteradas antes da renovação.");
  }

  if (input.action.type === "change_plan") {
    return createPlanChange(admin, subscription, input.action.offerReference);
  }
  if (input.action.type === "add_addon") {
    return createAddonChange(admin, subscription, input.action.addonCode, "add", input.action.quantity);
  }
  return createAddonChange(admin, subscription, input.action.addonCode, "remove", input.action.quantity);
}
