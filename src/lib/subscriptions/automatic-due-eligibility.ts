import { PREPAID_GRACE_PERIOD_DAYS } from "@/lib/subscriptions/lifecycle";

export type AutomaticBillingSubscriptionState = {
  id: string;
  status: string;
  billing_model: string;
  current_period_end: string | null;
};

/**
 * Cobrança recorrente só ocorre do vencimento até o BLOQUEIO financeiro.
 * Depois desse prazo, a assinatura pausada só pode ser renovada por
 * iniciativa explícita do cliente/administrador, nunca por cron ou reenvio.
 */
export function isEligibleForAutomaticDueBilling(
  subscription: AutomaticBillingSubscriptionState,
  dueAt: string,
  nowMs = Date.now(),
) {
  if (
    subscription.billing_model !== "prepaid" ||
    !["active", "past_due"].includes(subscription.status) ||
    !subscription.current_period_end
  ) return false;

  const currentDueMs = new Date(subscription.current_period_end).getTime();
  const originalDueMs = new Date(dueAt).getTime();
  if (!Number.isFinite(currentDueMs) || !Number.isFinite(originalDueMs)) return false;

  // Se a assinatura já foi renovada, nunca repetir cobrança do ciclo antigo.
  if (Math.abs(currentDueMs - originalDueMs) > 60_000) return false;

  const ageMs = nowMs - currentDueMs;
  const graceMs = PREPAID_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;
  return ageMs >= 0 && ageMs < graceMs;
}
