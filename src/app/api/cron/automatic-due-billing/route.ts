import { NextResponse } from "next/server";
import { processAutomaticDueBilling } from "@/lib/subscriptions/automatic-due-billing";

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
    const result = await processAutomaticDueBilling(100);

    return NextResponse.json({
      ok: true,
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
