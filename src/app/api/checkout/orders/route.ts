import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, optionalString, requiredString } from "@/lib/api/http";
import { createCheckout } from "@/lib/checkout/checkout-service";

export async function POST(request: Request) {
  try {
    const body = asObject(await request.json());
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 120) throw new HttpError(400, "Header Idempotency-Key obrigatorio.");
    const result = await createCheckout({
      offerSlug: requiredString(body, "offerSlug", 120),
      customerEmail: requiredString(body, "customerEmail", 320),
      customerName: optionalString(body, "customerName", 180),
      refCode: optionalString(body, "refCode", 80),
      idempotencyKey,
    });
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) { return jsonError(error); }
}
