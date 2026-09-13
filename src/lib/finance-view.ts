import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
export async function getFinanceView() {
 const {user,supabase}=await requireUser(); const admin=createAdminClient();
 const [{data:orders,error:ordersError},{data:commissions,error:commissionsError},{data:balance,error:balanceError},{data:withdrawals,error:withdrawalsError}]=await Promise.all([
  admin.from("orders").select("id,status,product_id,offer_id,gross_amount_cents,settlement_model,created_at,customers(name,email),products(name),offers!orders_offer_id_fkey(name),financial_snapshots(gateway_fee_amount_cents,prosperity_fee_amount_cents,affiliate_amount_cents,coproducer_amount_cents,producer_amount_cents)").eq("producer_id",user.id).order("created_at",{ascending:false}).limit(500),
  admin.from("commissions").select("id,payment_id,commission_type,status,amount_cents,available_at,created_at,payments!commissions_payment_id_fkey(orders!payments_order_id_fkey(products(name),offers!orders_offer_id_fkey(name)))").eq("beneficiary_user_id",user.id).order("created_at",{ascending:false}).limit(500),
  supabase.from("user_balance_summary").select("*").eq("user_id",user.id).maybeSingle(),
  supabase.from("withdrawals").select("id,status,amount_cents,created_at,payout_key_last4").eq("user_id",user.id).order("created_at",{ascending:false}).limit(100),
 ]);
 if(ordersError||commissionsError||balanceError||withdrawalsError) throw ordersError||commissionsError||balanceError||withdrawalsError;
 const ids=(orders??[]).map(o=>o.id);
 const {data:payments,error:paymentsError}=ids.length?await admin.from("payments").select("id,order_id,status,external_payment_id,external_reference,gross_amount_cents,provider_fee_amount_cents,created_at,paid_at,raw_provider_data,payment_transactions(transaction_type,status,occurred_at,created_at)").in("order_id",ids).order("created_at",{ascending:false}):{data:[],error:null};
 if(paymentsError) throw paymentsError;
 return {orders:orders??[],commissions:commissions??[],balance:balance??{pending_cents:0,available_cents:0,withdrawing_cents:0,total_received_cents:0},withdrawals:withdrawals??[],payments:payments??[]};
}
