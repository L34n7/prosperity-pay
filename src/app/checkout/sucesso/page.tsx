import { OrderResult } from "@/components/checkout/order-result";
export default async function Page({ searchParams }: { searchParams: Promise<{ order?: string }> }) { const { order } = await searchParams; return <OrderResult orderId={order}/>; }
