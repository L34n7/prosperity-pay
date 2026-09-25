import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_:Request,{params}:{params:Promise<{productId:string}>}){
  try{
    const {productId}=await params;const {supabase}=await requireUser();
    const {data:owns}=await supabase.rpc("owns_product",{target_product_id:productId});
    if(!owns)return NextResponse.json({error:"Produto não encontrado."},{status:404});
    const admin=createAdminClient();
    const [programResult,productResult,offersResult]=await Promise.all([
      admin.from("affiliate_programs").select("id,mode,active,cookie_days,terms,attribution_model,customer_data_access,marketplace_enabled,commission_addons,commission_prorated_changes,support_email,landing_page_url,marketplace_description,marketplace_tags").eq("product_id",productId).maybeSingle(),
      admin.from("products").select("settlement_model,payment_type,prosperity_fee_type,prosperity_fee_bps,prosperity_fee_fixed_cents").eq("id",productId).single(),
      admin.from("offers").select("id,name,price_cents,status,affiliate_enabled,affiliate_commission_bps,prosperity_fee_type,prosperity_fee_bps,prosperity_fee_fixed_cents").eq("product_id",productId).order("created_at")
    ]);
    if(programResult.error)throw programResult.error;if(productResult.error)throw productResult.error;if(offersResult.error)throw offersResult.error;
    const memberships=programResult.data?await admin.from("affiliate_memberships").select("id,code,status,partner_type,created_at,affiliate_commission_bps_override,profiles!affiliate_memberships_user_id_fkey(full_name,email)").eq("program_id",programResult.data.id).order("created_at",{ascending:false}):{data:[],error:null};
    if(memberships.error)throw memberships.error;
    const membershipRows=memberships.data??[];
    const membershipIds=membershipRows.map((item)=>item.id);
    const overrides=membershipIds.length
      ? await admin.from("affiliate_offer_commission_overrides").select("membership_id,offer_id,commission_bps").in("membership_id",membershipIds)
      : {data:[],error:null};
    if(overrides.error)throw overrides.error;
    const grouped=new Map<string,Array<{offer_id:string;commission_bps:number}>>();
    for(const item of overrides.data??[]){
      const current=grouped.get(item.membership_id)??[];
      current.push({offer_id:item.offer_id,commission_bps:Number(item.commission_bps)});
      grouped.set(item.membership_id,current);
    }
    return NextResponse.json({
      program:programResult.data,
      product:productResult.data,
      offers:offersResult.data??[],
      memberships:membershipRows.map((item)=>({...item,offer_commission_overrides:grouped.get(item.id)??[]})),
    });
  }catch(error){return jsonError(error)}
}
