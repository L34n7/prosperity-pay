export type SettlementModel = "connected_account" | "prosperity_balance";
export type FeeRule = {
  type: "percentage" | "fixed" | "hybrid";
  basisPoints: number;
  fixedCents: number;
};
export type ParticipantShare = { userId: string; basisPoints: number };

export type DistributionInput = {
  grossAmountCents: number;
  gatewayFeeCents: number;
  settlementModel: SettlementModel;
  producerId: string;
  prosperityFee: FeeRule;
  affiliate?: { userId: string; rule: FeeRule };
  coproducers: ParticipantShare[];
};

export type FinancialAllocation = {
  type: "producer" | "affiliate" | "coproducer" | "prosperity_fee" | "gateway_fee";
  destination: "internal_balance" | "connected_account" | "platform_revenue" | "gateway";
  beneficiaryUserId: string | null;
  amountCents: number;
  ruleSnapshot: Record<string, string | number | boolean>;
};

function assertCents(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} deve ser inteiro e nao negativo.`);
}

function fee(baseCents: number, rule: FeeRule) {
  assertCents(rule.fixedCents, "Taxa fixa");
  if (!Number.isInteger(rule.basisPoints) || rule.basisPoints < 0 || rule.basisPoints > 10_000) {
    throw new Error("Basis points fora do intervalo permitido.");
  }
  const percentage = Math.floor((baseCents * rule.basisPoints + 5_000) / 10_000);
  if (rule.type === "percentage") return percentage;
  if (rule.type === "fixed") return rule.fixedCents;
  return percentage + rule.fixedCents;
}

export class FinancialDistributionService {
  calculate(input: DistributionInput) {
    assertCents(input.grossAmountCents, "Valor bruto");
    assertCents(input.gatewayFeeCents, "Taxa do gateway");
    if (input.grossAmountCents === 0) throw new Error("Valor bruto deve ser positivo.");

    const coproducerIds = new Set(input.coproducers.map((item) => item.userId));
    const eligibleAffiliate = input.affiliate && !coproducerIds.has(input.affiliate.userId)
      ? input.affiliate
      : undefined;
    const prosperityFeeCents = fee(input.grossAmountCents, input.prosperityFee);
    const affiliateCents = eligibleAffiliate ? fee(input.grossAmountCents, eligibleAffiliate.rule) : 0;
    const coproducerAmounts = input.coproducers.map((participant) => {
      if (participant.userId === input.producerId) throw new Error("Produtor nao pode ser coprodutor do proprio produto.");
      const amountCents = fee(input.grossAmountCents, {
        type: "percentage",
        basisPoints: participant.basisPoints,
        fixedCents: 0,
      });
      return { ...participant, amountCents };
    });
    const coproducerCents = coproducerAmounts.reduce((sum, item) => sum + item.amountCents, 0);
    const deductions = prosperityFeeCents + affiliateCents + coproducerCents
      + (input.settlementModel === "prosperity_balance" ? input.gatewayFeeCents : 0);
    const producerCents = input.grossAmountCents - deductions;
    if (producerCents < 0) throw new Error("A soma das distribuicoes ultrapassa o valor da venda.");

    const allocations: FinancialAllocation[] = [
      {
        type: "producer",
        destination: input.settlementModel === "connected_account" ? "connected_account" : "internal_balance",
        beneficiaryUserId: input.producerId,
        amountCents: producerCents,
        ruleSnapshot: { role: "primary_producer" },
      },
      {
        type: "prosperity_fee",
        destination: "platform_revenue",
        beneficiaryUserId: null,
        amountCents: prosperityFeeCents,
        ruleSnapshot: { ...input.prosperityFee },
      },
    ];

    if (input.gatewayFeeCents > 0) allocations.push({
      type: "gateway_fee", destination: "gateway", beneficiaryUserId: null,
      amountCents: input.gatewayFeeCents, ruleSnapshot: { observed: true },
    });
    if (eligibleAffiliate && affiliateCents > 0) allocations.push({
      type: "affiliate", destination: "internal_balance", beneficiaryUserId: eligibleAffiliate.userId,
      amountCents: affiliateCents, ruleSnapshot: { ...eligibleAffiliate.rule },
    });
    allocations.push(...coproducerAmounts.filter((item) => item.amountCents > 0).map((item) => ({
      type: "coproducer" as const, destination: "internal_balance" as const,
      beneficiaryUserId: item.userId, amountCents: item.amountCents,
      ruleSnapshot: { basisPoints: item.basisPoints },
    })));

    return {
      grossAmountCents: input.grossAmountCents,
      gatewayFeeCents: input.gatewayFeeCents,
      prosperityFeeCents,
      affiliateCents,
      coproducerCents,
      producerCents,
      prosperitySplitCents: input.settlementModel === "connected_account"
        ? prosperityFeeCents + affiliateCents + coproducerCents
        : 0,
      affiliateSuppressedByCoproduction: Boolean(input.affiliate && !eligibleAffiliate),
      allocations,
    };
  }
}
