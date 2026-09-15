import { OrderResult } from "@/components/checkout/order-result";

const ORDER_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function normalizeOrderId(value?: string) {
  return value?.match(ORDER_ID_PATTERN)?.[0];
}

export default async function Page({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const { order } = await searchParams;
  return <OrderResult orderId={normalizeOrderId(order)} />;
}
