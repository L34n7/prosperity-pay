import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, optionalString, requiredInteger, requiredString } from "@/lib/api/http";
import { createTransparentCheckout } from "@/lib/checkout/transparent-checkout-service";

function normalizeMercadoPagoTestCustomerEmail(email: string) {
  const value = email.trim().toLowerCase();
  const match = /^test_user_(\d+)@testuser\.com$/i.exec(value);
  return match ? `testuser${match[1]}@testuser.com` : value;
}

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

    const customerEmail = normalizeMercadoPagoTestCustomerEmail(requiredString(body, "customerEmail", 320));
    const result = await createTransparentCheckout({
      offerSlug: requiredString(body, "offerSlug", 120),
      customerEmail,
      customerName: optionalString(body, "customerName", 180),
      customerDocument: requiredString(body, "customerDocument", 30),
      refCode: optionalString(body, "refCode", 80),
      idempotencyKey,
      paymentMethod,
      card,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("[transparent-checkout] payment attempt failed", error);
    if (error instanceof HttpError && error.status >= 500) {
      return NextResponse.json({ error: "Não foi possível processar o pagamento. Tente novamente." }, { status: error.status });
    }
    return jsonError(error);
  }
}
