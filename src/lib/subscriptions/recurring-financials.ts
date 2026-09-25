import { FinancialDistributionService, type FeeRule } from "@/lib/financial/financial-distribution-service";
import {
  loadAddonCommissionOverrides,
  resolveOfferCommissionOverride,
} from "@/lib/affiliates/offer-commission-overrides";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
type FeeType = "percentage" | "fixed" | "hybrid";
type SettlementModel = "connected_account" | "prosperity_balance";

type RecurringProduct = {
  id: string;
  producer_id: string;
  settlement_model: SettlementModel;
  prosperity_fee_type: FeeType;
  prosperity_fee_bps: number;
  prosperity_fee_fixed_cents: number;
};

type RecurringOffer = {
  id: string;
  affiliate_enabled: boolean;
  affiliate_commission_type: FeeType;
  affiliate_commission_bps: number;
  affiliate_commission_fixed_cents: number;
  affiliate_recurrence_mode: "first_payment" | "limited_recurring" | "lifetime_recurring";
  affiliate_recurrence_cycles: number | null;
  prosperity_fee_type: FeeType | null;
  prosperity_fee_bps: number | null;
  prosperity_fee_fixed_cents: number | null;
};

export type AffiliateCommissionLine = {
  amountCents: number;
  addonId?: string | null;
};

function feeRule(type: FeeType, basisPoints: number, fixedCents: number): FeeRule {
  return { type, basisPoints, fixedCents };
}

function feeCents(baseCents: number, rule: FeeRule) {
  if (!Number.isSafeInteger(baseCents) || baseCents < 0) {
    throw new Error("Base de comissão inválida.");
  }
  if (!Number.isInteger(rule.basisPoints) || rule.basisPoints < 0 || rule.basisPoints > 10_000) {
    throw new Error("Percentual de comissão inválido.");
  }
  if (!Number.isSafeInteger(rule.fixedCents) || rule.fixedCents < 0) {
    throw new Error("Comissão fixa inválida.");
  }
  const percentage = Math.floor((baseCents * rule.basisPoints + 5_000) / 10_000);
  if (rule.type === "percentage") return percentage;
  if (rule.type === "fixed") return rule.fixedCents;
  return percentage + rule.fixedCents;
}

function affiliateApplies(offer: RecurringOffer, cycleNumber: number) {
  if (!offer.affiliate_enabled) return false;
  if (offer.affiliate_recurrence_mode === "lifetime_recurring") return true;
  if (offer.affiliate_recurrence_mode === "limited_recurring") {
    return cycleNumber <= Number(offer.affiliate_recurrence_cycles ?? 0);
  }
  return cycleNumber === 1;
}

export async function createRecurringSnapshot(input: {
  admin: AdminClient;
  orderId: string;
  originOrderId: string | null;
  affiliateMembershipId?: string | null;
  grossAmountCents: number;
  currency: string;
  cycleNumber: number;
  affiliateBaseAmountCents?: number;
  affiliateCommissionLines?: AffiliateCommissionLine[];
  product: RecurringProduct;
  offer: RecurringOffer;
}) {
  const {
    admin,
    orderId,
    originOrderId,
    affiliateMembershipId,
    grossAmountCents,
    currency,
    cycleNumber,
    affiliateBaseAmountCents,
    affiliateCommissionLines,
    product,
    offer,
  } = input;

  const { data: existing } = await admin
    .from("financial_snapshots")
    .select("id")
    .eq("order_id", orderId)
    .maybeSingle();
  if (existing) return existing.id;

  // Mercado Pago Subscriptions does not expose marketplace_fee/split for /preapproval.
  // In connected_account the full recurring charge settles in the producer account;
  // therefore we must not create internal credits that were not physically collected.
  const connectedRecurring = product.settlement_model === "connected_account";
  let affiliate: { userId: string; rule: FeeRule } | undefined;
  let effectiveAffiliateBaseAmountCents = affiliateBaseAmountCents ?? grossAmountCents;
  let affiliateCommissionBreakdown:
    | {
        fallbackBaseAmountCents: number;
        fallbackCommissionCents: number;
        addonOverrides: Array<{
          addonId: string;
          baseAmountCents: number;
          commissionBps: number;
          commissionCents: number;
        }>;
      }
    | null = null;
  let coproducers: Array<{ userId: string; basisPoints: number }> = [];

  if (!connectedRecurring) {
    const { data: participants, error: participantsError } = await admin
      .from("product_participants")
      .select("user_id, participation_bps, offer_id")
      .eq("product_id", product.id)
      .eq("active", true)
      .or(`offer_id.is.null,offer_id.eq.${offer.id}`);
    if (participantsError) throw participantsError;
    coproducers = (participants ?? []).map((item) => ({
      userId: item.user_id,
      basisPoints: item.participation_bps,
    }));

    const requestedBase = affiliateCommissionLines
      ? affiliateCommissionLines.reduce((sum, line) => sum + Math.max(0, Number(line.amountCents || 0)), 0)
      : effectiveAffiliateBaseAmountCents;

    if (requestedBase > 0 && affiliateApplies(offer, cycleNumber)) {
      let membershipRow: {
        id: string;
        user_id: string;
        affiliate_commission_bps_override: number | null;
      } | null = null;

      if (affiliateMembershipId) {
        const { data, error } = await admin
          .from("affiliate_memberships")
          .select("id,user_id,affiliate_commission_bps_override,affiliate_programs!inner(active,product_id)")
          .eq("id", affiliateMembershipId)
          .eq("status", "active")
          .maybeSingle();
        if (error) throw error;
        const program = data?.affiliate_programs;
        const programRow = Array.isArray(program) ? program[0] : program;
        if (data?.user_id && programRow?.active && programRow.product_id === product.id) {
          membershipRow = {
            id: data.id,
            user_id: data.user_id,
            affiliate_commission_bps_override: data.affiliate_commission_bps_override,
          };
        }
      } else if (originOrderId) {
        const { data: attribution, error: attributionError } = await admin
          .from("affiliate_attributions")
          .select("affiliate_membership_id,affiliate_memberships!inner(user_id,affiliate_commission_bps_override)")
          .eq("order_id", originOrderId)
          .maybeSingle();
        if (attributionError) throw attributionError;
        const membership = attribution?.affiliate_memberships;
        const raw = Array.isArray(membership) ? membership[0] : membership;
        if (raw?.user_id && attribution?.affiliate_membership_id) {
          membershipRow = {
            id: attribution.affiliate_membership_id,
            user_id: raw.user_id,
            affiliate_commission_bps_override: raw.affiliate_commission_bps_override,
          };
        }
      }

      if (membershipRow?.user_id) {
        const overrideBasisPoints = await resolveOfferCommissionOverride({
          admin,
          membershipId: membershipRow.id,
          offerId: offer.id,
          legacyMembershipOverride: membershipRow.affiliate_commission_bps_override,
        });

        const fallbackRule = overrideBasisPoints == null
          ? feeRule(
              offer.affiliate_commission_type,
              Number(offer.affiliate_commission_bps),
              Number(offer.affiliate_commission_fixed_cents),
            )
          : feeRule("percentage", Number(overrideBasisPoints), 0);

        if (affiliateCommissionLines) {
          const normalizedLines = affiliateCommissionLines
            .map((line) => ({
              amountCents: Math.max(0, Math.round(Number(line.amountCents || 0))),
              addonId: line.addonId ?? null,
            }))
            .filter((line) => line.amountCents > 0);

          effectiveAffiliateBaseAmountCents = normalizedLines.reduce(
            (sum, line) => sum + line.amountCents,
            0,
          );

          const addonIds = normalizedLines
            .map((line) => line.addonId)
            .filter((addonId): addonId is string => Boolean(addonId));
          const addonOverrides = await loadAddonCommissionOverrides({
            admin,
            membershipId: membershipRow.id,
            addonIds,
          });

          let fallbackBaseAmountCents = 0;
          const explicitAddonLines: Array<{
            addonId: string;
            baseAmountCents: number;
            commissionBps: number;
            commissionCents: number;
          }> = [];

          for (const line of normalizedLines) {
            if (line.addonId && addonOverrides.has(line.addonId)) {
              const commissionBps = Number(addonOverrides.get(line.addonId));
              explicitAddonLines.push({
                addonId: line.addonId,
                baseAmountCents: line.amountCents,
                commissionBps,
                commissionCents: feeCents(
                  line.amountCents,
                  feeRule("percentage", commissionBps, 0),
                ),
              });
            } else {
              fallbackBaseAmountCents += line.amountCents;
            }
          }

          const fallbackCommissionCents = fallbackBaseAmountCents > 0
            ? feeCents(fallbackBaseAmountCents, fallbackRule)
            : 0;
          const explicitAddonCommissionCents = explicitAddonLines.reduce(
            (sum, item) => sum + item.commissionCents,
            0,
          );
          const exactCommissionCents =
            fallbackCommissionCents + explicitAddonCommissionCents;

          affiliateCommissionBreakdown = {
            fallbackBaseAmountCents,
            fallbackCommissionCents,
            addonOverrides: explicitAddonLines,
          };

          if (exactCommissionCents > 0) {
            affiliate = {
              userId: membershipRow.user_id,
              rule: feeRule("fixed", 0, exactCommissionCents),
            };
          }
        } else {
          affiliate = {
            userId: membershipRow.user_id,
            rule: fallbackRule,
          };
        }
      }
    }
  }

  const result = new FinancialDistributionService().calculate({
    grossAmountCents,
    gatewayFeeCents: 0,
    settlementModel: product.settlement_model,
    producerId: product.producer_id,
    prosperityFee: connectedRecurring
      ? feeRule("fixed", 0, 0)
      : feeRule(
          offer.prosperity_fee_type ?? product.prosperity_fee_type,
          Number(offer.prosperity_fee_bps ?? product.prosperity_fee_bps),
          Number(offer.prosperity_fee_fixed_cents ?? product.prosperity_fee_fixed_cents),
        ),
    affiliate,
    affiliateBaseAmountCents: effectiveAffiliateBaseAmountCents,
    coproducers,
  });

  const { data: snapshot, error: snapshotError } = await admin
    .from("financial_snapshots")
    .insert({
      order_id: orderId,
      settlement_model: product.settlement_model,
      currency,
      gross_amount_cents: result.grossAmountCents,
      gateway_fee_amount_cents: result.gatewayFeeCents,
      prosperity_fee_amount_cents: result.prosperityFeeCents,
      affiliate_amount_cents: result.affiliateCents,
      coproducer_amount_cents: result.coproducerCents,
      producer_amount_cents: result.producerCents,
      prosperity_split_amount_cents: result.prosperitySplitCents,
      rules: {
        calculationVersion: affiliateCommissionLines ? 2 : 1,
        recurring: true,
        cycleNumber,
        affiliateBaseAmountCents: effectiveAffiliateBaseAmountCents,
        affiliateCommissionBreakdown,
        gatewayFeePendingReconciliation: true,
        affiliateSuppressedByCoproduction: result.affiliateSuppressedByCoproduction,
        connectedRecurringDirectSettlement: connectedRecurring,
      },
    })
    .select("id")
    .single();
  if (snapshotError || !snapshot) {
    throw snapshotError ?? new Error("Falha ao criar snapshot recorrente.");
  }

  const allocations = result.allocations
    .filter((allocation) => allocation.amountCents > 0)
    .map((allocation) => ({
      snapshot_id: snapshot.id,
      allocation_type: allocation.type,
      destination: allocation.destination,
      beneficiary_user_id: allocation.beneficiaryUserId,
      amount_cents: allocation.amountCents,
      currency,
      rule_snapshot: allocation.ruleSnapshot,
    }));

  if (allocations.length) {
    const { error: allocationError } = await admin.from("financial_allocations").insert(allocations);
    if (allocationError) throw allocationError;
  }

  return snapshot.id;
}
