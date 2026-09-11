import type { Metadata } from "next";
import { CheckoutFlow } from "@/components/checkout/checkout-flow";

export const metadata: Metadata = {
  title: "Plano Básico",
  description: "Checkout seguro do plano Básico Prosperity CRM.",
};

export default async function BasicCheckoutPage({ searchParams }: { searchParams: Promise<{ ref?: string }> }) {
  const { ref } = await searchParams;
  return <CheckoutFlow affiliate={ref} />;
}
