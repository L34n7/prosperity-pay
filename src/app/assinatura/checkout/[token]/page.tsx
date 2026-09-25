import { notFound } from "next/navigation";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { env } from "@/lib/env";
import { getSubscriptionCheckoutSessionView } from "@/lib/checkout/subscription-session-checkout";
import { productImageUrl } from "@/lib/product-images";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let session: Awaited<ReturnType<typeof getSubscriptionCheckoutSessionView>>;
  try {
    session = await getSubscriptionCheckoutSessionView(token);
  } catch {
    notFound();
  }

  const addonLines = session.lines.filter(
    (line) => line.lineType === "addon" && Number(line.quantity || 0) > 0
  );
  const addonNames = addonLines.map((line) => {
    const quantity = Math.max(1, Number(line.quantity || 1));
    return quantity > 1
      ? `${line.description} × ${quantity}`
      : line.description;
  });
  const checkoutTitle = [session.offer.name, ...addonNames]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" + ");

  const priceComposition = session.lines.map((line) => ({
    label:
      line.lineType === "base"
        ? session.offer.name
        : line.description,
    amountCents: Number(line.totalAmountCents || 0),
    quantity: Math.max(1, Number(line.quantity || 1)),
    type: line.lineType,
  }));

  return <CheckoutFlow
    offer={{
      slug: `subscription-${token.slice(0, 12)}`,
      productId: "subscription-session",
      name:
        checkoutTitle ||
        (session.sessionType === "subscription_renewal"
          ? "Renovação da assinatura"
          : "Alteração da assinatura"),
      priceCents: session.amountCents,
      firstChargeCents: null,
      billingType: "one_time",
      billingInterval: null,
      billingIntervalCount: null,
      maxInstallments: 1,
      paymentCardEnabled: true,
      paymentPixEnabled: true,
      productName: session.product.name,
      imageUrl: productImageUrl(session.product.image_path),
    }}
    mercadoPagoPublicKey={env.mercadoPagoPublicKey}
    checkoutEndpoint="/api/checkout/subscription-session"
    sessionToken={token}
    initialBuyer={session.customer}
    prepaidSubscription
    priceComposition={priceComposition}
    successText="Pagamento confirmado. A Prosperity Pay aplicou a alteração correspondente à sua assinatura."
    successUrl="/"
    successLabel="Concluir"
  />;
}
