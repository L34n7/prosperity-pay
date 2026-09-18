import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, optionalString, requiredInteger, requiredString } from "@/lib/api/http";
import { createTransparentCheckout } from "@/lib/checkout/transparent-checkout-service";
import { deliverCrmProsperityWebhookForOrder } from "@/lib/integrations/crm-prosperity-order-delivery";
import { createAdminClient } from "@/lib/supabase/admin";

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
      deviceId: optionalString(body, "deviceId", 255),
      idempotencyKey,
      paymentMethod,
      card,
    });

    // O retorno do próprio Mercado Pago já pode trazer o pagamento como
    // aprovado antes do webhook assíncrono. Entregamos o estado final ao CRM
    // imediatamente e mantemos o webhook/polling como redundância idempotente,
    // sem depender de uma segunda notificação para liberar o acesso do cliente.
    if (["approved", "rejected", "cancelled", "refunded"].includes(result.status)) {
      await deliverCrmProsperityWebhookForOrder(
        createAdminClient(),
        result.orderId,
      );
    }

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
