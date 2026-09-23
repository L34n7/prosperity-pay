import { NextResponse } from "next/server";
import { HttpError, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";

export async function GET(_: Request, { params }: { params: Promise<{ productId: string }> }) {
  try {
    const { productId } = await params;
    const { supabase } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) throw new HttpError(404, "Produto não encontrado.");

    const { data: subscriptions, error } = await supabase.from("subscriptions")
      .select("id,customer_id,offer_id,status,billing_model,base_amount_cents,current_amount_cents,currency,current_period_start,current_period_end,next_due_at,cycle_number,created_at")
      .eq("product_id", productId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    if (!subscriptions?.length) return NextResponse.json({ subscriptions: [] });

    const ids = subscriptions.map(item => item.id);
    const customerIds = [...new Set(subscriptions.map(item => item.customer_id))];
    const offerIds = [...new Set(subscriptions.map(item => item.offer_id))];

    const [customersResult, offersResult, itemsResult, changesResult] = await Promise.all([
      supabase.from("customers").select("id,name,email").in("id", customerIds),
      supabase.from("offers").select("id,name,checkout_slug").in("id", offerIds),
      supabase.from("subscription_items")
        .select("id,subscription_id,item_type,code,description,unit_amount_cents,quantity,status,activated_at,ended_at")
        .in("subscription_id", ids).eq("status", "active").order("created_at"),
      supabase.from("subscription_changes")
        .select("id,subscription_id,change_type,status,quoted_target_amount_cents,proration_amount_cents,effective_mode,effective_at,created_at")
        .in("subscription_id", ids)
        .in("status", ["quoted","awaiting_payment","payment_approved","scheduled","applying"])
        .order("created_at"),
    ]);
    if (customersResult.error) throw customersResult.error;
    if (offersResult.error) throw offersResult.error;
    if (itemsResult.error) throw itemsResult.error;
    if (changesResult.error) throw changesResult.error;

    const customers = new Map((customersResult.data ?? []).map(item => [item.id, item]));
    const offers = new Map((offersResult.data ?? []).map(item => [item.id, item]));
    return NextResponse.json({
      subscriptions: subscriptions.map(subscription => ({
        ...subscription,
        customer: customers.get(subscription.customer_id) ?? null,
        offer: offers.get(subscription.offer_id) ?? null,
        items: (itemsResult.data ?? []).filter(item => item.subscription_id === subscription.id),
        pendingChanges: (changesResult.data ?? []).filter(item => item.subscription_id === subscription.id),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
