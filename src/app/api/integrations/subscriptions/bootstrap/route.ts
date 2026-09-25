import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, optionalString, requiredString } from "@/lib/api/http";
import { requireSignedIntegrationRequest } from "@/lib/integrations/inbound-auth";
import { createAdminClient } from "@/lib/supabase/admin";

function positiveCents(value: unknown, fallback: number) {
  if (value == null) return fallback;
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, "Valor contratado inválido.");
  return amount;
}

function timestamp(value: string, field: string) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new HttpError(400, `${field} inválido.`);
  return parsed;
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const { integrationKey } = await requireSignedIntegrationRequest(request, rawBody);

    let parsed: unknown;
    try { parsed = JSON.parse(rawBody); }
    catch { throw new HttpError(400, "JSON inválido."); }

    const body = asObject(parsed);
    const externalReference = requiredString(body, "externalReference", 180);
    const offerReference = requiredString(body, "offerReference", 120).toLowerCase();
    const customerEmail = requiredString(body, "customerEmail", 320).trim().toLowerCase();
    const customerName = optionalString(body, "customerName", 180);
    const start = timestamp(requiredString(body, "currentPeriodStart", 80), "Início do período");
    const end = timestamp(requiredString(body, "currentPeriodEnd", 80), "Fim do período");
    if (end.getTime() <= start.getTime()) throw new HttpError(400, "O fim do período precisa ser posterior ao início.");
    if (!/^\S+@\S+\.\S+$/.test(customerEmail)) throw new HttpError(400, "E-mail inválido.");

    const admin = createAdminClient();
    const { data: offer, error: offerError } = await admin.from("offers")
      .select("id,product_id,price_cents,currency,billing_type,status")
      .eq("checkout_slug", offerReference)
      .maybeSingle();
    if (offerError) throw offerError;
    if (!offer) throw new HttpError(404, "Oferta não encontrada.");
    if (offer.status !== "active" || offer.billing_type !== "recurring") {
      throw new HttpError(409, "A oferta não está habilitada como assinatura pré-paga.");
    }

    const { data: product, error: productError } = await admin.from("products")
      .select("id,settlement_model,billing_model")
      .eq("id", offer.product_id)
      .single();
    if (productError || !product) throw productError ?? new HttpError(404, "Produto não encontrado.");
    if (product.billing_model !== "prepaid") throw new HttpError(409, "Produto incompatível com importação pré-paga.");
    if (product.settlement_model !== "prosperity_balance") {
      throw new HttpError(409, "A importação de assinatura exige recebimento pelo Saldo Prosperity.");
    }

    const { data: routes, error: routeError } = await admin.from("integration_webhook_routes")
      .select("offer_reference")
      .eq("integration", integrationKey)
      .eq("active", true);
    if (routeError) throw routeError;

    const references = (routes ?? [])
      .map((route) => String(route.offer_reference || "").trim())
      .filter(Boolean);

    const { data: allowedOffer, error: allowedOfferError } = references.length > 0
      ? await admin.from("offers")
          .select("id")
          .eq("product_id", offer.product_id)
          .in("checkout_slug", references)
          .limit(1)
          .maybeSingle()
      : { data: null, error: null };

    if (allowedOfferError) throw allowedOfferError;
    if (!allowedOffer) {
      throw new HttpError(
        403,
        "Esta integração não pode importar ofertas deste produto."
      );
    }

    const { data: existing, error: existingError } = await admin.from("subscriptions")
      .select("id,status,current_amount_cents,current_period_start,current_period_end,next_due_at")
      .eq("product_id", offer.product_id)
      .eq("external_reference", externalReference)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing) return NextResponse.json({ subscription: existing, imported: false });

    let customerId: string;
    const { data: existingCustomer, error: customerLookupError } = await admin.from("customers")
      .select("id,name")
      .eq("email", customerEmail)
      .maybeSingle();
    if (customerLookupError) throw customerLookupError;
    if (existingCustomer) {
      customerId = existingCustomer.id;
      if (customerName && customerName !== existingCustomer.name) {
        const { error } = await admin.from("customers").update({ name: customerName }).eq("id", customerId);
        if (error) throw error;
      }
    } else {
      const { data: created, error } = await admin.from("customers")
        .insert({ email: customerEmail, name: customerName ?? null })
        .select("id")
        .single();
      if (error || !created) throw error ?? new Error("Falha ao registrar cliente.");
      customerId = created.id;
    }

    let affiliateMembershipId: string | null = null;
    let affiliateLinkId: string | null = null;
    const affiliateRefCode = optionalString(body, "affiliateRefCode", 120);
    if (affiliateRefCode) {
      const { data: link, error: linkError } = await admin.from("affiliate_links")
        .select("id,membership_id")
        .eq("ref_code", affiliateRefCode)
        .eq("active", true)
        .maybeSingle();
      if (linkError) throw linkError;

      if (link) {
        const { data: membership, error: membershipError } = await admin.from("affiliate_memberships")
          .select("id,program_id,status")
          .eq("id", link.membership_id)
          .maybeSingle();
        if (membershipError) throw membershipError;

        if (membership?.status === "active") {
          const { data: program, error: programError } = await admin.from("affiliate_programs")
            .select("id,product_id,active")
            .eq("id", membership.program_id)
            .maybeSingle();
          if (programError) throw programError;

          if (program?.active && program.product_id === offer.product_id) {
            affiliateMembershipId = membership.id;
            affiliateLinkId = link.id;
          }
        }
      }
    }

    const { data: mercadoPagoProvider, error: providerError } = await admin.from("payment_providers")
      .select("id")
      .eq("code", "mercadopago")
      .single();
    if (providerError || !mercadoPagoProvider) throw providerError ?? new HttpError(503, "Provedor Mercado Pago não configurado.");

    const { data: connection, error: connectionError } = await admin.from("payment_provider_connections")
      .select("provider_id")
      .eq("connection_kind", "prosperity_balance")
      .eq("provider_id", mercadoPagoProvider.id)
      .is("owner_user_id", null)
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (connectionError) throw connectionError;
    if (!connection) throw new HttpError(503, "Conta Mercado Pago central não configurada.");

    const contractedBaseAmountCents = positiveCents(body.contractedBaseAmountCents, Number(offer.price_cents));
    const status = end.getTime() > Date.now() ? "active" : "past_due";

    const { data: importResult, error: importError } = await admin.rpc("import_prepaid_subscription", {
      target_product_id: offer.product_id,
      target_customer_id: customerId,
      target_offer_id: offer.id,
      target_provider_id: connection.provider_id,
      target_external_reference: externalReference,
      target_status: status,
      target_amount_cents: contractedBaseAmountCents,
      target_currency: offer.currency,
      target_period_start: start.toISOString(),
      target_period_end: end.toISOString(),
      target_affiliate_membership_id: affiliateMembershipId,
      target_affiliate_link_id: affiliateLinkId,
      target_item_code: offerReference,
      target_item_description: `Plano contratado · ${offerReference}`,
      target_metadata: {
        imported: true,
        integration: integrationKey,
        importedAt: new Date().toISOString(),
      },
    });
    if (importError) throw importError;

    const importedRow = importResult?.[0];
    if (!importedRow) throw new Error("Falha ao importar assinatura.");

    const { data: subscription, error: subscriptionError } = await admin.from("subscriptions")
      .select("id,status,current_amount_cents,current_period_start,current_period_end,next_due_at")
      .eq("id", importedRow.subscription_id)
      .single();
    if (subscriptionError || !subscription) throw subscriptionError ?? new Error("Assinatura importada não encontrada.");

    return NextResponse.json(
      { subscription, imported: importedRow.imported },
      { status: importedRow.imported ? 201 : 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
