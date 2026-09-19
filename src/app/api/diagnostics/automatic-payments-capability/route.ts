import { NextResponse } from "next/server";
import { env, requireEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

type CustomerSearch = {
  results?: Array<{ id?: string }>;
};

export async function GET() {
  const token = requireEnv(env.mercadoPagoAccessToken, "MERCADO_PAGO_ACCESS_TOKEN");
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const searchResponse = await fetch(
    "https://api.mercadopago.com/v1/customers/search?limit=1",
    { headers, cache: "no-store" },
  );

  let searchBody: CustomerSearch & Record<string, unknown> = {};
  try {
    searchBody = await searchResponse.json() as CustomerSearch & Record<string, unknown>;
  } catch {
    searchBody = {};
  }

  const existingCustomerId = searchBody.results?.[0]?.id;
  const customerId = existingCustomerId ?? "999999999-aaaaaaaaaaaaaa";

  const profileResponse = await fetch(
    `https://api.mercadopago.com/v1/customers/${encodeURIComponent(customerId)}/payment-profiles?limit=1`,
    { headers, cache: "no-store" },
  );

  let profileBody: Record<string, unknown> = {};
  try {
    profileBody = await profileResponse.json() as Record<string, unknown>;
  } catch {
    profileBody = {};
  }

  const results = Array.isArray(profileBody.results) ? profileBody.results : [];
  return NextResponse.json({
    customerSearchStatus: searchResponse.status,
    customerFound: Boolean(existingCustomerId),
    paymentProfileProbePerformed: true,
    paymentProfileStatus: profileResponse.status,
    automaticPaymentsAvailable: profileResponse.ok,
    existingProfileCountInProbe: results.length,
    providerBody: profileResponse.ok ? null : JSON.stringify(profileBody).slice(0, 1200),
  });
}
