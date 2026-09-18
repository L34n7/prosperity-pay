import { NextResponse } from "next/server";
import { asObject, jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

type Context={params:Promise<{productId:string}>};
function text(value:unknown,max:number){if(value==null)return null;const v=String(value).trim();if(!v)return null;if(v.length>max)throw new Error("LONG");return v}
function url(value:unknown){const v=text(value,2048);if(!v)return null;try{const parsed=new URL(v);if(!["http:","https:"].includes(parsed.protocol))throw new Error();return v}catch{throw new Error("URL")}}
function tags(value:unknown){if(!Array.isArray(value))return[];const v=Array.from(new Set(value.map(x=>String(x).trim()).filter(Boolean)));if(v.length>20||v.some(x=>x.length>50))throw new Error("TAGS");return v}

export async function PUT(request:Request,context:Context){
  try{
    const {productId}=await context.params;const {supabase}=await requireUser();const {data:owns}=await supabase.rpc("owns_product",{target_product_id:productId});
    if(!owns)return NextResponse.json({error:"Produto não encontrado."},{status:404});
    const body=asObject(await request.json());const mode=body.mode;
    if(!["public","approval","invite"].includes(String(mode)))return NextResponse.json({error:"Modo de afiliação inválido."},{status:400});
    const attributionModel=body.attributionModel;if(attributionModel!=="last_click"&&attributionModel!=="first_click")return NextResponse.json({error:"Modelo de atribuição inválido."},{status:400});
    const cookieDays=Number(body.cookieDays??30);if(!Number.isInteger(cookieDays)||cookieDays<1||cookieDays>365)return NextResponse.json({error:"Duração do cookie inválida."},{status:400});
    let supportEmail,landingPageUrl,marketplaceDescription,terms,marketplaceTags;
    try{supportEmail=text(body.supportEmail,320);if(supportEmail&&!/^\S+@\S+\.\S+$/.test(supportEmail))return NextResponse.json({error:"E-mail de suporte inválido."},{status:400});landingPageUrl=url(body.landingPageUrl);marketplaceDescription=text(body.marketplaceDescription,4000);terms=text(body.terms,10000);marketplaceTags=tags(body.marketplaceTags)}catch(cause){const code=cause instanceof Error?cause.message:"";return NextResponse.json({error:code==="URL"?"URL da landing page inválida.":code==="TAGS"?"Use no máximo 20 tags, com até 50 caracteres cada.":"Um dos textos excedeu o limite permitido."},{status:400})}
    const admin=createAdminClient();
    const [productResult,offersResult]=await Promise.all([admin.from("products").select("payment_type,settlement_model").eq("id",productId).single(),admin.from("offers").select("id,affiliate_enabled,affiliate_commission_bps").eq("product_id",productId)]);
    if(productResult.error||!productResult.data)throw productResult.error??new Error("Produto não encontrado.");if(offersResult.error)throw offersResult.error;
    const offers=offersResult.data??[];const requested=Array.isArray(body.offers)?body.offers:[];const configs=new Map<string,{enabled:boolean;commissionBps:number}>();
    for(const raw of requested){if(!raw||typeof raw!=="object")return NextResponse.json({error:"Configuração de oferta inválida."},{status:400});const item=raw as Record<string,unknown>;const id=typeof item.id==="string"?item.id:"";const commissionBps=Number(item.commissionBps??0);if(!offers.some(o=>o.id===id))return NextResponse.json({error:"Uma das ofertas não pertence a este produto."},{status:400});if(!Number.isInteger(commissionBps)||commissionBps<0||commissionBps>10000)return NextResponse.json({error:"Comissão de afiliado inválida."},{status:400});const enabled=item.enabled===true;if(enabled&&commissionBps<=0)return NextResponse.json({error:"Defina uma comissão maior que 0% para cada oferta habilitada."},{status:400});configs.set(id,{enabled,commissionBps})}
    const merged=offers.map(o=>{const c=configs.get(o.id);return c?{...o,affiliate_enabled:c.enabled,affiliate_commission_bps:c.commissionBps}:o});const active=body.active===true;
    if(active&&!merged.some(o=>o.affiliate_enabled&&Number(o.affiliate_commission_bps)>0))return NextResponse.json({error:"Habilite ao menos uma oferta e defina sua comissão antes de ativar o programa."},{status:409});
    if(productResult.data.payment_type==="recurring"&&productResult.data.settlement_model==="connected_account"&&merged.some(o=>o.affiliate_enabled))return NextResponse.json({error:"Assinaturas recorrentes com recebimento direto no Mercado Pago não suportam comissão automática. Use Saldo Prosperity."},{status:409});
    const {data:program,error:programError}=await admin.from("affiliate_programs").upsert({product_id:productId,mode:mode as "public"|"approval"|"invite",active,cookie_days:cookieDays,terms,attribution_model:attributionModel,customer_data_access:body.customerDataAccess===true,marketplace_enabled:body.marketplaceEnabled===true,support_email:supportEmail,landing_page_url:landingPageUrl,marketplace_description:marketplaceDescription,marketplace_tags:marketplaceTags},{onConflict:"product_id"}).select().single();
    if(programError||!program)throw programError??new Error("Falha ao salvar programa.");
    for(const [offerId,c] of configs){const {error}=await admin.from("offers").update({affiliate_enabled:c.enabled,affiliate_commission_type:"percentage",affiliate_commission_bps:c.commissionBps,affiliate_commission_fixed_cents:0}).eq("id",offerId).eq("product_id",productId);if(error)throw error}
    const {data:savedOffers,error:savedError}=await admin.from("offers").select("id,name,price_cents,status,affiliate_enabled,affiliate_commission_bps,prosperity_fee_type,prosperity_fee_bps,prosperity_fee_fixed_cents").eq("product_id",productId).order("created_at");if(savedError)throw savedError;
    return NextResponse.json({program,offers:savedOffers??[]});
  }catch(error){return jsonError(error)}
}
