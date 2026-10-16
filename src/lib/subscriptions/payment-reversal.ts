import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

type ReversalRpcRow = {
  subscription_id?: string | null;
  order_id?: string | null;
  reverted?: boolean | null;
  reason?: string | null;
};

export async function revertPrepaidSubscriptionAfterPaymentReversal(
  admin: AdminClient,
  paymentId: string,
) {
  const { data, error } = await (admin as any).rpc(
    "revert_prepaid_subscription_payment",
    {
      target_payment_id: paymentId,
    },
  );

  if (error) {
    throw error;
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | ReversalRpcRow
    | null
    | undefined;

  const result = {
    subscriptionId: row?.subscription_id || null,
    orderId: row?.order_id || null,
    reverted: row?.reverted === true,
    reason: row?.reason || "no_result",
  };

  console.log("[SUBSCRIPTION PAYMENT REVERSAL]", {
    paymentId,
    ...result,
  });

  return result;
}
