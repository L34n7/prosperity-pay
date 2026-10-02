import { NextResponse } from "next/server";
import { asObject, HttpError, optionalString, requiredString } from "@/lib/api/http";
import { createCheckoutPrefillSession } from "@/lib/checkout/integration-prefill-session";
import { requireSignedIntegrationRequest } from "@/lib/integrations/inbound-auth";

export async function POST(request: Request) {
  const rawBody = await request.text();

  try {
    const { integrationKey } = await requireSignedIntegrationRequest(request, rawBody);

    if (integrationKey !== "crm_prosperity") {
      throw new HttpError(403, "Integração não autorizada para criar sessão de checkout.");
    }

    const body = asObject(JSON.parse(rawBody));
    const offerSlug = requiredString(body, "offerSlug", 120);
    const customerName = requiredString(body, "customerName", 180);
    const customerEmail = requiredString(body, "customerEmail", 320);
    const affiliateRef = optionalString(body, "affiliateRef", 128);
    const sourceReference = optionalString(body, "sourceReference", 200);

    if (affiliateRef && !/^[A-Za-z0-9_-]+$/.test(affiliateRef)) {
      throw new HttpError(400, "Referência de afiliado inválida.");
    }

    const session = await createCheckoutPrefillSession({
      integrationKey,
      offerSlug,
      customerName,
      customerEmail,
      affiliateRef,
      sourceReference,
    });

    const checkoutUrl = new URL(
      `/checkout/${encodeURIComponent(session.offerSlug)}?session=${encodeURIComponent(session.token)}`,
      request.url,
    ).toString();

    return NextResponse.json(
      {
        ok: true,
        checkout_url: checkoutUrl,
        expires_at: session.expiresAt,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("[checkout-prefill] Falha ao criar sessão.", error);

    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Não foi possível preparar o checkout." },
      { status: 400 },
    );
  }
}
