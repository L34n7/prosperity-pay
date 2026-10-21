import { NextResponse } from "next/server";
import {
  asObject,
  jsonError,
  optionalString,
  requiredString,
} from "@/lib/api/http";
import { resolveExistingSubscriptionCheckout } from "@/lib/subscriptions/existing-subscription-checkout";

export async function POST(request: Request) {
  try {
    const body = asObject(await request.json());
    const result = await resolveExistingSubscriptionCheckout({
      offerSlug: requiredString(body, "offerSlug", 120),
      customerEmail: requiredString(body, "customerEmail", 320),
      affiliateRefCode: optionalString(body, "refCode", 120),
    });

    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
