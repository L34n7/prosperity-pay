import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/ui/page-header";
import { AffiliateLinks, AvailablePrograms } from "@/components/affiliate-links";
import { PartnerCustomerPortfolio } from "@/components/partner-customer-portfolio";
import { getPartnerCustomerPortfolio } from "@/lib/partners/customer-portfolio";
export const dynamic="force-dynamic";
export default async function Page(){
 const {user,supabase}=await requireUser();
 const admin=env.supabaseServiceRoleKey?createAdminClient():null;
 const membershipQuery=(admin??supabase).from("affiliate_memberships")
  .select("id,code,status,partner_type,affiliate_programs(product_id,mode,active,products(name,affiliate_funnel_base_url,offers(name,checkout_slug,status)))")
  .eq("user_id",user.id);
 const [portfolio,{data:memberships,error},{data:programs,error:programError}]=await Promise.all([
  getPartnerCustomerPortfolio(),
  membershipQuery,
  admin?admin.from("affiliate_programs").select("id,mode,marketplace_description,marketplace_tags,landing_page_url,products(id,name,producer_id)").eq("active",true).eq("marketplace_enabled",true).neq("mode","invite").limit(100):Promise.resolve({data:[],error:null}),
 ]);
 if(error)throw error;
 if(programError)console.error("Falha ao consultar o catálogo de afiliados",{code:programError.code});
 const joined=new Set((memberships??[]).map(m=>m.affiliate_programs?.product_id));
 const available=(programs??[]).filter(p=>p.products?.producer_id!==user.id&&!joined.has(p.products?.id));
 return <><PageHeader title="Minhas afiliações" description="Indique ofertas, acompanhe clientes e comissões."/><section className="panel operational-panel"><h2>Suas afiliações</h2>{memberships?.length?<AffiliateLinks memberships={memberships}/>:<p>Você ainda não participa de programas de afiliados.</p>}</section><PartnerCustomerPortfolio portfolio={portfolio} title="Clientes indicados" description="Clientes que compraram por suas indicações, com situação da assinatura, renovação e comissões." emptyText="Quando uma venda for atribuída ao seu link, o cliente aparecerá aqui."/><section className="panel operational-panel"><h2>Programas disponíveis</h2>{admin&&!programError?available.length?<AvailablePrograms programs={available}/>:<p>Nenhum programa público disponível no momento.</p>:<p>O catálogo de programas está indisponível no momento.</p>}</section></>;
}
