import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export const PREPAID_GRACE_PERIOD_DAYS = 7;

export async function synchronizePrepaidSubscriptionLifecycle(
  admin: AdminClient,
  options: { subscriptionIds?: string[] } = {},
) {
  const subscriptionIds = Array.from(
    new Set((options.subscriptionIds || []).filter(Boolean)),
  );
  const now = new Date();
  const nowIso = now.toISOString();
  const blockedCutoffIso = new Date(
    now.getTime() - PREPAID_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  let pauseQuery = admin
    .from("subscriptions")
    .update({
      status: "paused",
      next_due_at: null,
      updated_at: nowIso,
    })
    .eq("billing_model", "prepaid")
    .in("status", ["active", "past_due"])
    .not("current_period_end", "is", null)
    .lte("current_period_end", blockedCutoffIso);

  if (subscriptionIds.length) {
    pauseQuery = pauseQuery.in("id", subscriptionIds);
  }

  const paused = await pauseQuery;
  if (paused.error) throw paused.error;

  let pastDueQuery = admin
    .from("subscriptions")
    .update({
      status: "past_due",
      updated_at: nowIso,
    })
    .eq("billing_model", "prepaid")
    .eq("status", "active")
    .not("current_period_end", "is", null)
    .lte("current_period_end", nowIso);

  if (subscriptionIds.length) {
    pastDueQuery = pastDueQuery.in("id", subscriptionIds);
  }

  const pastDue = await pastDueQuery;
  if (pastDue.error) throw pastDue.error;

  return {
    synchronizedAt: nowIso,
    gracePeriodDays: PREPAID_GRACE_PERIOD_DAYS,
  };
}
