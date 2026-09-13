import { getFinanceView } from "@/lib/finance-view";
import { PaymentsView } from "@/components/payments-view";
export const dynamic="force-dynamic";
export default async function Page() {const data=await getFinanceView();return <PaymentsView orders={data.orders} payments={data.payments}/>;}
