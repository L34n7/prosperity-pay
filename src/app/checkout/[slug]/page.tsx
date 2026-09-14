import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";
import { productImageUrl } from "@/lib/product-images";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string }> }) {
  const [{ slug }, { ref }] = await Promise.all([params, searchParams]);
  const { data: offer } = await createAdminClient().from("offers")
    .select("checkout_slug, name, price_cents, first_charge_cents, billing_type, billing_interval, billing_interval_count, products!inner(name, description, image_path, status)")
    .eq("checkout_slug", slug)
    .eq("status", "active")
    .eq("products.status", "active")
    .maybeSingle();
  if (!offer) notFound();
  return <CheckoutFlow offer={{
    slug: offer.checkout_slug,
    name: offer.name,
    priceCents: Number(offer.price_cents),
    firstChargeCents: offer.first_charge_cents == null ? null : Number(offer.first_charge_cents),
    billingType: offer.billing_type,
    billingInterval: offer.billing_interval,
    billingIntervalCount: offer.billing_interval_count,
    productName: offer.products.name,
    description: offer.products.description,
    imageUrl: productImageUrl(offer.products.image_path),
  }} affiliate={ref}/>;
}
