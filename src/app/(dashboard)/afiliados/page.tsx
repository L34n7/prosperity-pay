import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { PageHeader } from "@/components/ui/page-header";
import { AffiliateLinks, AvailablePrograms } from "@/components/affiliate-links";
export const dynamic="force-dynamic";
export default async function Page(){
 const {user,supabase}=await requireUser();
 const admin=env.supabaseServiceRoleKey?createAdminClient():null;
 const [{data:memberships,error},{data:programs,error:programError}]=await Promise.all([
  supabase.from("affiliate_memberships").select("id,code,status,affiliate_programs(product_id,products(name,offers(name,checkout_slug,status)))").eq("user_id",user.id),
  admin?admin.from("affiliate_programs").select("id,mode,products(id,name,producer_id)").eq("active",true).eq("marketplace_enabled",true).neq("mode","invite").limit(100):Promise.resolve({data:[],error:null}),
 ]);
 if(error)throw error;
 if(programError)console.error("Falha ao consultar o catálogo de afiliados",{code:programError.code});
 const joined=new Set((memberships??[]).map(m=>m.affiliate_programs?.product_id));
 const available=(programs??[]).filter(p=>p.products?.producer_id!==user.id&&!joined.has(p.products?.id));
 return <><PageHeader title="Minhas afiliações" description="Indique ofertas e acompanhe suas comissões."/><section className="panel operational-panel"><h2>Suas afiliações</h2>{memberships?.length?<AffiliateLinks memberships={memberships}/>:<p>Você ainda não participa de programas de afiliados.</p>}</section><section className="panel operational-panel"><h2>Programas disponíveis</h2>{admin&&!programError?available.length?<AvailablePrograms programs={available}/>:<p>Nenhum programa público disponível no momento.</p>:<p>O catálogo de programas está indisponível no momento.</p>}</section></>;
}
