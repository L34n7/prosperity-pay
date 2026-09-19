import { NextResponse } from "next/server";
import { env, requireEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = requireEnv(env.mercadoPagoAccessToken, "MERCADO_PAGO_ACCESS_TOKEN");
  const probeCustomerId = "prosperity-capability-probe-does-not-exist";

  const response = await fetch(
    `https://api.mercadopago.com/v1/customers/${encodeURIComponent(probeCustomerId)}/payment-profiles?limit=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    },
  );

  let body: Record<string, unknown> = {};
  try {
    body = await response.json() as Record<string, unknown>;
  } catch {
    body = {};
  }

  const message = String(body.message ?? body.error ?? "").slice(0, 500);
  const safeBody = JSON.stringify(body).slice(0, 1500);
  const available =
    response.ok ||
    (response.status === 404 && /customer|cliente|not found|not_found/i.test(message));

  return NextResponse.json({
    providerStatus: response.status,
    endpointRecognized: response.status !== 404 || available,
    automaticPaymentsLikelyAvailable: available,
    providerMessage: message || null,
    providerBody: safeBody,
  });
}
