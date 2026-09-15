import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, optionalString, requiredInteger, requiredString } from "@/lib/api/http";
import { createTransparentCheckout } from "@/lib/checkout/transparent-checkout-service";

export async function POST(request: Request) {
  try {
    const body = asObject(await request.json());
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 120) throw new HttpError(400, "Header Idempotency-Key obrigatório.");
    const paymentMethod = requiredString(body, "paymentMethod", 20);
    if (paymentMethod !== "card" && paymentMethod !== "pix") throw new HttpError(400, "Forma de pagamento inválida.");

    let card: { token: string; paymentMethodId: string; installments: number; issuerId?: string } | undefined;
    if (paymentMethod === "card") {
      const cardInput = asObject(body.card);
      card = {
        token: requiredString(cardInput, "token", 300),
        paymentMethodId: requiredString(cardInput, "paymentMethodId", 80),
        installments: requiredInteger(cardInput, "installments", 1),
        issuerId: optionalString(cardInput, "issuerId", 80),
      };
    }

    const result = await createTransparentCheckout({
      offerSlug: requiredString(body, "offerSlug", 120),
      customerEmail: requiredString(body, "customerEmail", 320),
      customerName: optionalString(body, "customerName", 180),
      customerDocument: requiredString(body, "customerDocument", 30),
      refCode: optionalString(body, "refCode", 80),
      idempotencyKey,
      paymentMethod,
      card,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
