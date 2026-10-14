import { NextResponse } from "next/server";
import {
  asObject,
  HttpError,
  jsonError,
  requiredString,
} from "@/lib/api/http";
import { requireSignedIntegrationRequest } from "@/lib/integrations/inbound-auth";
import { createAdminClient } from "@/lib/supabase/admin";

function normalizarEmail(valor: string) {
  return valor.trim().toLowerCase();
}

async function ensureIntegrationOwnsProduct(
  integrationKey: string,
  productId: string
) {
  const admin = createAdminClient();

  const { data: routes, error: routeError } = await admin
    .from("integration_webhook_routes")
    .select("offer_reference")
    .eq("integration", integrationKey)
    .eq("active", true);

  if (routeError) throw routeError;

  const references = (routes ?? [])
    .map((route) => String(route.offer_reference || "").trim())
    .filter(Boolean);

  if (references.length === 0) {
    throw new HttpError(
      403,
      "Esta integração não pode alterar clientes deste produto."
    );
  }

  const { data: allowedOffer, error: allowedOfferError } = await admin
    .from("offers")
    .select("id")
    .eq("product_id", productId)
    .in("checkout_slug", references)
    .limit(1)
    .maybeSingle();

  if (allowedOfferError) throw allowedOfferError;
  if (!allowedOffer) {
    throw new HttpError(
      403,
      "Esta integração não pode alterar clientes deste produto."
    );
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const { integrationKey } = await requireSignedIntegrationRequest(
      request,
      rawBody
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new HttpError(400, "JSON inválido.");
    }

    const body = asObject(parsed);
    const subscriptionId = requiredString(body, "subscriptionId", 80);
    const customerEmail = normalizarEmail(
      requiredString(body, "customerEmail", 320)
    );

    if (!/^\S+@\S+\.\S+$/.test(customerEmail)) {
      throw new HttpError(400, "E-mail inválido.");
    }

    const admin = createAdminClient();

    const { data: subscription, error: subscriptionError } = await admin
      .from("subscriptions")
      .select("id,customer_id,product_id")
      .eq("id", subscriptionId)
      .single();

    if (subscriptionError || !subscription) {
      throw subscriptionError ?? new HttpError(404, "Assinatura não encontrada.");
    }

    await ensureIntegrationOwnsProduct(integrationKey, subscription.product_id);

    const { data: customer, error: customerError } = await admin
      .from("customers")
      .select("id,email,name")
      .eq("id", subscription.customer_id)
      .single();

    if (customerError || !customer) {
      throw customerError ?? new HttpError(404, "Cliente não encontrado.");
    }

    if (normalizarEmail(customer.email || "") === customerEmail) {
      return NextResponse.json({
        ok: true,
        changed: false,
        customer: {
          id: customer.id,
          email: customerEmail,
          name: customer.name,
        },
      });
    }

    const { data: emailOwner, error: emailOwnerError } = await admin
      .from("customers")
      .select("id")
      .eq("email", customerEmail)
      .neq("id", customer.id)
      .limit(1)
      .maybeSingle();

    if (emailOwnerError) throw emailOwnerError;
    if (emailOwner) {
      throw new HttpError(
        409,
        "O novo e-mail já está vinculado a outro cliente da Prosperity Pay."
      );
    }

    const { data: updated, error: updateError } = await admin
      .from("customers")
      .update({
        email: customerEmail,
        updated_at: new Date().toISOString(),
      })
      .eq("id", customer.id)
      .select("id,email,name")
      .single();

    if (updateError || !updated) {
      throw updateError ?? new Error("Falha ao atualizar e-mail do cliente.");
    }

    return NextResponse.json({
      ok: true,
      changed: true,
      customer: updated,
    });
  } catch (error) {
    return jsonError(error);
  }
}
