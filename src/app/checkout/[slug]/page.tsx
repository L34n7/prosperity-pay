import { notFound } from "next/navigation";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { env } from "@/lib/env";
import { productImageUrl } from "@/lib/product-images";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const OFFER_SELECT = "product_id,checkout_slug,name,price_cents,first_charge_cents,billing_type,billing_interval,billing_interval_count,max_installments,payment_card_enabled,payment_pix_enabled,products!inner(*)";

type CheckoutProduct = {
  name: string;
  image_path: string | null;
  status: string;
  post_purchase_message?: string | null;
  post_purchase_redirect_url?: string | null;
};

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string }> }) {
  const [{ slug }, { ref }] = await Promise.all([params, searchParams]);
  const admin = createAdminClient();

  const exact = await admin.from("offers")
    .select(OFFER_SELECT)
    .eq("checkout_slug", slug.toLowerCase())
    .eq("status", "active")
    .eq("products.status", "active")
    .maybeSingle();

  let offer = exact.data;

  if (!offer && /^[a-f0-9]{8}$/i.test(slug)) {
    const legacy = await admin.from("offers")
      .select(OFFER_SELECT)
      .like("checkout_slug", `%-${slug.toLowerCase()}`)
      .eq("status", "active")
      .eq("products.status", "active")
      .limit(1)
      .maybeSingle();
    offer = legacy.data;
  }

  if (!offer) notFound();

  const product = offer.products as unknown as CheckoutProduct;
  const { data: affiliateProgram } = await admin.from("affiliate_programs")
    .select("id,active,cookie_days,attribution_model")
    .eq("product_id", offer.product_id)
    .maybeSingle();

  return <CheckoutFlow
    offer={{
      slug: offer.checkout_slug,
      productId: offer.product_id,
      name: offer.name,
      priceCents: Number(offer.price_cents),
      firstChargeCents: offer.first_charge_cents == null ? null : Number(offer.first_charge_cents),
      billingType: offer.billing_type,
      billingInterval: offer.billing_interval,
      billingIntervalCount: offer.billing_interval_count,
      maxInstallments: Number(offer.max_installments),
      paymentCardEnabled: Boolean(offer.payment_card_enabled),
      paymentPixEnabled: Boolean(offer.payment_pix_enabled),
      productName: product.name,
      imageUrl: productImageUrl(product.image_path),
    }}
    affiliate={ref}
    affiliateAttribution={affiliateProgram?.active ? {
      cookieDays: affiliateProgram.cookie_days,
      attributionModel: affiliateProgram.attribution_model,
    } : undefined}
    mercadoPagoPublicKey={env.mercadoPagoPublicKey}
    successText={product.post_purchase_message ?? undefined}
    successUrl={product.post_purchase_redirect_url ?? undefined}
    successLabel={product.post_purchase_redirect_url ? "Continuar" : undefined}
  />;
}
