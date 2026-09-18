import { NextResponse } from "next/server";

const ALLOWED_EVENTS = new Set([
  "card_form_mounted",
  "card_form_mount_error",
  "card_submit_clicked",
  "card_submit_not_observed",
  "card_submit_observed",
  "card_sdk_fetching",
  "card_buyer_validation_failed",
  "card_token_missing",
  "card_token_ready",
  "card_form_data_error",
  "card_attempt_reset",
  "card_retry_required",
  "card_retry_reload",
]);

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      event?: unknown;
      offerSlug?: unknown;
      message?: unknown;
    };

    const event = String(body.event ?? "").trim();
    const offerSlug = String(body.offerSlug ?? "").trim().slice(0, 120);
    const message = String(body.message ?? "").trim().slice(0, 300);

    if (!ALLOWED_EVENTS.has(event) || !offerSlug) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    console.info("[checkout-client-event]", {
      event,
      offerSlug,
      ...(message ? { message } : {}),
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
