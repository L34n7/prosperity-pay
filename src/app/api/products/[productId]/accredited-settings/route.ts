import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ productId: string }> };

const DEFAULTS = {
  active: true,
  allow_direct_invites: true,
  allow_affiliate_evolution: true,
  customer_portfolio_access: true,
  customer_contact_access: true,
  subscription_details_access: true,
};

export async function GET(_: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("product_accredited_settings")
      .select("product_id,active,allow_direct_invites,allow_affiliate_evolution,customer_portfolio_access,customer_contact_access,subscription_details_access,created_at,updated_at")
      .eq("product_id", productId)
      .maybeSingle();

    if (error) throw error;
    return NextResponse.json({
      settings: data ?? { product_id: productId, ...DEFAULTS, created_at: null, updated_at: null },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { productId } = await context.params;
    const { supabase } = await requireUser();
    const { data: owns } = await supabase.rpc("owns_product", { target_product_id: productId });
    if (!owns) return NextResponse.json({ error: "Produto não encontrado." }, { status: 404 });

    const body = asObject(await request.json());
    const customerPortfolioAccess = body.customerPortfolioAccess === true;

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("product_accredited_settings")
      .upsert({
        product_id: productId,
        active: body.active === true,
        allow_direct_invites: body.allowDirectInvites === true,
        allow_affiliate_evolution: body.allowAffiliateEvolution === true,
        customer_portfolio_access: customerPortfolioAccess,
        customer_contact_access: customerPortfolioAccess && body.customerContactAccess === true,
        subscription_details_access: customerPortfolioAccess && body.subscriptionDetailsAccess === true,
        updated_at: new Date().toISOString(),
      }, { onConflict: "product_id" })
      .select("product_id,active,allow_direct_invites,allow_affiliate_evolution,customer_portfolio_access,customer_contact_access,subscription_details_access,created_at,updated_at")
      .single();

    if (error || !data) throw error ?? new Error("Falha ao salvar configurações de credenciados.");
    return NextResponse.json({ settings: data });
  } catch (error) {
    return jsonError(error);
  }
}
