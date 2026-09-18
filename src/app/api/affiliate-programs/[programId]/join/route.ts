import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

type Context={params:Promise<{programId:string}>};
function createCode(email?:string|null){return `${(email?.split("@")[0]??"AFILIADO").replace(/[^a-z0-9]/gi,"").toUpperCase().slice(0,12)}${randomBytes(3).toString("hex").toUpperCase()}`}

export async function POST(_:Request,context:Context){
  try{
    const {programId}=await context.params;const {user}=await requireUser();const admin=createAdminClient();
    const {data:program,error:programError}=await admin.from("affiliate_programs").select("mode,active,products(producer_id)").eq("id",programId).single();
    if(programError||!program?.active)return NextResponse.json({error:"Programa indisponível."},{status:404});
    if(program.products&&!Array.isArray(program.products)&&program.products.producer_id===user.id)return NextResponse.json({error:"O produtor não pode se afiliar ao próprio produto."},{status:409});
    if(program.mode==="invite")return NextResponse.json({error:"Este programa aceita apenas convidados."},{status:403});

    const {data:existing,error:existingError}=await admin.from("affiliate_memberships").select("id,code,status").eq("program_id",programId).eq("user_id",user.id).maybeSingle();
    if(existingError)throw existingError;
    if(existing?.status==="blocked")return NextResponse.json({error:"Sua participação neste programa está bloqueada."},{status:403});
    if(existing?.status==="active"||existing?.status==="pending")return NextResponse.json({membership:existing,alreadyJoined:true});

    const status=program.mode==="public"?"active":"pending";const code=existing?.code||createCode(user.email);
    const result=existing
      ? await admin.from("affiliate_memberships").update({code,status,approved_at:status==="active"?new Date().toISOString():null,approved_by:null}).eq("id",existing.id).select().single()
      : await admin.from("affiliate_memberships").insert({program_id:programId,user_id:user.id,code,status,approved_at:status==="active"?new Date().toISOString():null}).select().single();
    if(result.error||!result.data)throw result.error??new Error("Falha ao criar afiliação.");

    if(status==="active"){
      const {error}=await admin.from("affiliate_links").upsert({membership_id:result.data.id,ref_code:result.data.code},{onConflict:"ref_code"});
      if(error)throw error;
    }
    return NextResponse.json({membership:result.data},{status:existing?200:201});
  }catch(error){return jsonError(error)}
}
