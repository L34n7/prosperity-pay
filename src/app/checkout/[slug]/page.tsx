import { notFound } from "next/navigation";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { env } from "@/lib/env";
import { productImageUrl } from "@/lib/product-images";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string }> }) {
  const [{ slug }, { ref }] = await Promise.all([params, searchParams]);
  const { data: offer } = await createAdminClient().from("offers")
    .select("checkout_slug,name,price_cents,first_charge_cents,billing_type,billing_interval,billing_interval_count,max_installments,payment_card_enabled,payment_pix_enabled,products!inner(name,description,image_path,status)")
    .eq("checkout_slug", slug)
    .eq("status", "active")
    .eq("products.status", "active")
    .maybeSingle();
  if (!offer) notFound();

  return <CheckoutFlow
    offer={{
      slug: offer.checkout_slug,
      name: offer.name,
      priceCents: Number(offer.price_cents),
      firstChargeCents: offer.first_charge_cents == null ? null : Number(offer.first_charge_cents),
      billingType: offer.billing_type,
      billingInterval: offer.billing_interval,
      billingIntervalCount: offer.billing_interval_count,
      maxInstallments: Number(offer.max_installments),
      paymentCardEnabled: Boolean(offer.payment_card_enabled),
      paymentPixEnabled: Boolean(offer.payment_pix_enabled),
      productName: offer.products.name,
      description: offer.products.description,
      imageUrl: productImageUrl(offer.products.image_path),
    }}
    affiliate={ref}
    mercadoPagoPublicKey={env.mercadoPagoPublicKey}
  />;
}
