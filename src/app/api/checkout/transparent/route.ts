import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, optionalString, requiredInteger, requiredString } from "@/lib/api/http";
import { createTransparentCheckout } from "@/lib/checkout/transparent-checkout-service";
import { resolveExistingSubscriptionCheckout } from "@/lib/subscriptions/existing-subscription-checkout";

export async function POST(request: Request) {
  try {
    const body = asObject(await request.json());
    const idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || idempotencyKey.length > 120) throw new HttpError(400, "Header Idempotency-Key obrigatório.");
    const paymentMethod = requiredString(body, "paymentMethod", 20);
    if (paymentMethod !== "card" && paymentMethod !== "pix") throw new HttpError(400, "Forma de pagamento inválida.");

    const offerSlug = requiredString(body, "offerSlug", 120);
    const customerEmail = requiredString(body, "customerEmail", 320);
    const refCode = optionalString(body, "refCode", 80);

    const existingSubscription = await resolveExistingSubscriptionCheckout({
      offerSlug,
      customerEmail,
      affiliateRefCode: refCode,
    });

    if (existingSubscription.matched) {
      if (existingSubscription.checkoutUrl) {
        return NextResponse.json(
          {
            error:
              "Este cliente já possui uma assinatura deste produto. Continue pelo checkout da assinatura existente.",
            existingSubscription: true,
            checkoutUrl: existingSubscription.checkoutUrl,
          },
          { status: 409 },
        );
      }

      if (existingSubscription.scheduled) {
        return NextResponse.json(
          {
            error:
              "A alteração foi agendada para o próximo ciclo. Nenhuma nova assinatura foi criada.",
            existingSubscription: true,
            scheduled: true,
            effectiveAt: existingSubscription.effectiveAt,
          },
          { status: 409 },
        );
      }

      return NextResponse.json(
        {
          error:
            existingSubscription.requiresPlanChange
              ? existingSubscription.message ||
                "Este cliente já possui o produto em outro plano. Faça a alteração em Gerenciar plano."
              : "Este cliente já possui uma assinatura deste produto. Nenhuma nova assinatura foi criada.",
          existingSubscription: true,
          requiresPlanChange: existingSubscription.requiresPlanChange ?? false,
        },
        { status: 409 },
      );
    }

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
      offerSlug,
      customerEmail,
      customerName: optionalString(body, "customerName", 180),
      customerDocument: requiredString(body, "customerDocument", 30),
      refCode,
      deviceId: optionalString(body, "deviceId", 255),
      idempotencyKey,
      paymentMethod,
      card,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error("[transparent-checkout] payment attempt failed", error);

    if (error instanceof HttpError) {
      const providerMessage = error.message || "";

      if (providerMessage.includes("CC_VAL_433")) {
        return NextResponse.json(
          {
            error:
              "O Mercado Pago recusou a validação deste cartão. Confira os dados ou tente outro cartão. Os campos do cartão serão recarregados para uma nova tentativa.",
          },
          { status: 422 }
        );
      }

      if (providerMessage.toLowerCase().includes("card token was used")) {
        return NextResponse.json(
          {
            error:
              "Os dados seguros deste cartão já foram utilizados em uma tentativa anterior. Preencha o cartão novamente para gerar um novo token.",
          },
          { status: 409 }
        );
      }

      if (error.status >= 500) {
        return NextResponse.json(
          { error: "Não foi possível processar o pagamento. Tente novamente." },
          { status: error.status }
        );
      }
    }

    return jsonError(error);
  }
}
