
import { NextResponse } from "next/server";
import { getProviderAccessToken } from "@/lib/payments/provider-credentials";

const connectionId = "3561fc97-5fe3-4f3f-9ae5-daf66f0b62d8";
const paymentId = "PAY01M4XKT2WS86VQG3H7WHGBCXJX";
const orderId = "ORD01M4XKT2WHEHKSGQMMG17GV23M";
const externalReference = "prosperity-a9516221-0180-4372-bfc9-8260b760037e";

async function probe(path: string) {
  const token = await getProviderAccessToken(connectionId);
  const response = await fetch("https://api.mercadopago.com" + path, {
    headers: { Authorization: "Bearer " + token },
    cache: "no-store",
  });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = await response.text();
  }
  return { status: response.status, body };
}

export async function GET() {
  const [byPaymentId, searchByReference, byOrder] = await Promise.all([
    probe("/v1/payments/" + encodeURIComponent(paymentId)),
    probe("/v1/payments/search?external_reference=" + encodeURIComponent(externalReference)),
    probe("/v1/orders/" + encodeURIComponent(orderId)),
  ]);

  return NextResponse.json({
    byPaymentId,
    searchByReference,
    byOrder,
  });
}
