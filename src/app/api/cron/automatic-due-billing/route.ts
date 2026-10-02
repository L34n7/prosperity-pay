import { NextResponse } from "next/server";
import { processAutomaticDueBilling } from "@/lib/subscriptions/automatic-due-billing";
import { expireStalePayments } from "@/lib/payments/expire-stale-payments";
import { createAdminClient } from "@/lib/supabase/admin";

function authorized(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");

  if (cronSecret) {
    return authorization === `Bearer ${cronSecret}`;
  }

  // Fallback for environments where CRON_SECRET has not been configured yet.
  // The billing engine itself is idempotent and only processes subscriptions
  // that are already due and whose product explicitly enabled this feature.
  const userAgent = request.headers.get("user-agent") || "";
  return process.env.VERCEL_ENV === "production" &&
    userAgent.toLowerCase().startsWith("vercel-cron/");
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const admin = createAdminClient();
    const expiredPayments = await expireStalePayments(admin);
    const result = await processAutomaticDueBilling(100);

    return NextResponse.json({
      ok: true,
      expiredPayments,
      ...result,
    });
  } catch (error) {
    console.error("[CRON AUTOMATIC DUE BILLING] Falha geral", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Falha ao processar cobranças automáticas.",
      },
      { status: 500 },
    );
  }
}
