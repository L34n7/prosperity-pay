import { NextResponse } from "next/server";
import { asObject, HttpError, jsonError, requiredString, requiredInteger } from "@/lib/api/http";
import { requirePlatformAdmin } from "@/lib/auth/require-user";

const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(body:Record<string,unknown>,key:string) {
  const value=requiredString(body,key,36);
  if(!uuidPattern.test(value))throw new HttpError(400,"Identificador inválido: "+key);
  return value;
}
function date(body:Record<string,unknown>,key:string) {
  const value=requiredString(body,key,10);
  if(!/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value))
    throw new HttpError(400,"Data inválida.");
  const parsed=new Date(value+"T12:00:00Z");
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)
    throw new HttpError(400,"Data inválida.");
  return value;
}
function on(dateString:string) {
  const [y,m,d]=dateString.slice(0,10).split("-").map(Number);
  return y>1999&&m>=1&&m<=12&&d>=1&&d<=31;
}
function movement(body:Record<string,unknown>,key:string):string {
  const raw=body[key];
  if(!raw) return new Date().toISOString();
  if(typeof raw!=="string"||!/^20\d{2}-(0[1-9]|1[0-2])-[0-3]\dT[0-2]\d:[0-5]\d$/.test(raw)||!on(raw))
    throw new HttpError(400,"Data e hora inválidas.");
  const parsed=new Date(raw+":00-03:00");
  const local=new Intl.DateTimeFormat("en-US",{
    timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",hourCycle:"h23",
  }).formatToParts(parsed);
  const part=(type:string)=>local.find(x=>x.type===type)?.value;
  const serialized=part("year")+"-"+part("month")+"-"+part("day")+"T"+part("hour")+":"+part("minute");
  if(serialized!==raw||Number.isNaN(parsed.getTime()))throw new HttpError(400,"Data e hora inválidas.");
  return parsed.toISOString();
}
function failDb(error:{code?:string;message:string}|null) {
  if(!error)return;
  if(error.code==="23505")throw new HttpError(409,"Este lançamento já foi registrado ou o nome está em uso.");
  if(error.code==="23503")throw new HttpError(400,"Banco, cartão ou caixa inválido.");
  if(error.code==="23514")throw new HttpError(400,"Valores e situação inconsistentes.");
  if(/Mes fechado|Fatura|fatura|Pagamento|pagamento|banco real ativo|recebimento/i.test(error.message))
    throw new HttpError(409,error.message);
  throw error;
}
async function add(request:Request) {
  const {supabase,user}=await requirePlatformAdmin();
  const body=asObject(await request.json());
  const action=requiredString(body,"action",45);
  if(action==="card_payment"){
    const token=uuid(body,"clientToken");
    const existing=await supabase.from("finance_card_payments").select("*")
      .eq("owner_user_id",user.id).eq("client_token",token).maybeSingle();
    failDb(existing.error);
    if(existing.data)return NextResponse.json({record:existing.data,deduplicated:true});
    const invoiceMonth=date(body,"invoiceMonth");
    if(!invoiceMonth.endsWith("-01"))throw new HttpError(400,"Mês da fatura inválido.");
    const amount=requiredInteger(body,"amountCents",1);
    if(amount>999999999999)throw new HttpError(400,"Valor muito alto.");
    const result=await supabase.from("finance_card_payments").insert({
      owner_user_id:user.id,card_id:uuid(body,"cardId"),invoice_month:invoiceMonth,
      bank_id:uuid(body,"bankId"),box_id:uuid(body,"boxId"),
      amount_cents:amount,paid_at:movement(body,"paidAt"),client_token:token,
      notes:body.notes?requiredString(body,"notes",1000):null,
    }).select("*").single();
    if(result.error?.code==="23505"){
      const repeated=await supabase.from("finance_card_payments").select("*")
        .eq("owner_user_id",user.id).eq("client_token",token).maybeSingle();
      failDb(repeated.error);
      if(repeated.data)return NextResponse.json({record:repeated.data,deduplicated:true});
    }
    failDb(result.error);
    return NextResponse.json({record:result.data},{status:201});
  }
  if(action==="card_adjustment"){
    const month=date(body,"invoiceMonth");
    if(!month.endsWith("-01"))throw new HttpError(400,"Mês inválido.");
    if(body.kind!=="credit"&&body.kind!=="debit")throw new HttpError(400,"Tipo do ajuste inválido.");
    const amount=requiredInteger(body,"amountCents",1);
    const result=await supabase.from("finance_card_adjustments").insert({
      owner_user_id:user.id,card_id:uuid(body,"cardId"),box_id:uuid(body,"boxId"),
      invoice_month:month,kind:body.kind,title:requiredString(body,"title",160),
      amount_cents:amount,notes:body.notes?requiredString(body,"notes",1000):null,
    }).select("*").single();
    failDb(result.error);
    return NextResponse.json({record:result.data},{status:201});
  }
  if(action==="expected_income"){
    const amount=requiredInteger(body,"amountCents",1);
    if(amount>999999999999)throw new HttpError(400,"Valor muito alto.");
    const result=await supabase.from("finance_expected_incomes").insert({
      owner_user_id:user.id,title:requiredString(body,"title",160),
      amount_cents:amount,expected_on:date(body,"expectedOn"),
      bank_id:uuid(body,"bankId"),box_id:uuid(body,"boxId"),
      status:"expected",received_at:null,
      notes:body.notes?requiredString(body,"notes",1000):null,
    }).select("*").single();
    failDb(result.error);
    return NextResponse.json({record:result.data},{status:201});
  }
  if(action==="card"){
    const name=requiredString(body,"name",100);
    const dueDay=requiredInteger(body,"dueDay",1);
    if(dueDay>31)throw new HttpError(400,"Dia de vencimento inválido.");
    const source=uuid(body,"sourceBankId");
    const bank=body.defaultBankId?uuid(body,"defaultBankId"):null;
    if(bank){
      const res=await supabase.from("finance_banks").select("id,active")
        .eq("owner_user_id",user.id).eq("id",bank).maybeSingle();
      failDb(res.error);
      if(!res.data?.active)throw new HttpError(400,"O banco pagador deve estar ativo.");
    }
    const result=await supabase.from("finance_cards").insert({
      owner_user_id:user.id,name,legacy_bank_id:source,
      default_payment_bank_id:bank,due_day:dueDay,closing_day:null,active:true,
    }).select("*").single();
    failDb(result.error);
    return NextResponse.json({record:result.data},{status:201});
  }
  throw new HttpError(400,"Ação não reconhecida.");
}
async function change(request:Request){
  const {supabase,user}=await requirePlatformAdmin();
  const body=asObject(await request.json()),action=requiredString(body,"action",45),id=uuid(body,"id");
  if(action==="card"){
    const day=requiredInteger(body,"dueDay",1);
    if(day>31)throw new HttpError(400,"Dia de vencimento inválido.");
    let closeDay:number|null=null;
    if(body.closingDay!==null&&body.closingDay!==""&&body.closingDay!==undefined){
      closeDay=requiredInteger(body,"closingDay",1);
      if(closeDay>31)throw new HttpError(400,"Dia do fechamento inválido.");
    }
    const bank=body.defaultBankId?uuid(body,"defaultBankId"):null;
    if(bank){
      const res=await supabase.from("finance_banks").select("active")
        .eq("id",bank).eq("owner_user_id",user.id).maybeSingle();
      failDb(res.error);
      if(!res.data?.active)throw new HttpError(400,"O banco pagador deve estar ativo.");
    }
    const r=await supabase.from("finance_cards").update({
      name:requiredString(body,"name",100),due_day:day,closing_day:closeDay,
      default_payment_bank_id:bank,active:body.active!==false,
    }).eq("id",id).eq("owner_user_id",user.id).select("*").maybeSingle();
    failDb(r.error);
    if(!r.data)throw new HttpError(404,"Cartão não encontrado.");
    return NextResponse.json({record:r.data});
  }
  if(action==="expected_income"){
    const existing=await supabase.from("finance_expected_incomes").select("*")
      .eq("id",id).eq("owner_user_id",user.id).maybeSingle();
    failDb(existing.error);
    if(!existing.data)throw new HttpError(404,"Previsão não encontrada.");
    if(existing.data.status==="received")throw new HttpError(409,"Recebimento já confirmado. Estorne antes de editar.");
    if(existing.data.status==="cancelled")throw new HttpError(409,"Previsão cancelada.");
    if(body.status==="received"){
      const r=await supabase.from("finance_expected_incomes").update({
        status:"received",received_at:movement(body,"receivedAt"),
      }).eq("id",id).eq("owner_user_id",user.id).eq("status","expected").select("*").maybeSingle();
      failDb(r.error);
      if(!r.data)throw new HttpError(409,"A situação da previsão foi alterada.");
      return NextResponse.json({record:r.data});
    }
    if(body.status==="cancelled"){
      const r=await supabase.from("finance_expected_incomes").update({
        status:"cancelled",received_at:null,
      }).eq("id",id).eq("owner_user_id",user.id).eq("status","expected").select("*").maybeSingle();
      failDb(r.error);
      if(!r.data)throw new HttpError(409,"A previsão não está pendente.");
      return NextResponse.json({record:r.data});
    }
    const cents=requiredInteger(body,"amountCents",1);
    const r=await supabase.from("finance_expected_incomes").update({
      title:requiredString(body,"title",160),amount_cents:cents,
      expected_on:date(body,"expectedOn"),
      bank_id:uuid(body,"bankId"),box_id:uuid(body,"boxId"),
      notes:body.notes?requiredString(body,"notes",1000):null,
    }).eq("id",id).eq("owner_user_id",user.id).eq("status","expected").select("*").maybeSingle();
    failDb(r.error);
    if(!r.data)throw new HttpError(409,"Previsão não encontrada ou já realizada.");
    return NextResponse.json({record:r.data});
  }
  throw new HttpError(400,"Ação inválida.");
}
async function remove(request:Request){
  const {supabase,user}=await requirePlatformAdmin();
  const body=asObject(await request.json()),action=requiredString(body,"action",45),id=uuid(body,"id");
  if(action==="card_payment"){
    const r=await supabase.from("finance_card_payments").delete()
      .eq("id",id).eq("owner_user_id",user.id).select("id").maybeSingle();
    failDb(r.error);
    if(!r.data)throw new HttpError(404,"Pagamento não encontrado.");
    return NextResponse.json({ok:true});
  }
  if(action==="card_adjustment"){
    const r=await supabase.from("finance_card_adjustments").delete()
      .eq("id",id).eq("owner_user_id",user.id).select("id").maybeSingle();
    failDb(r.error);
    if(!r.data)throw new HttpError(404,"Ajuste não encontrado.");
    return NextResponse.json({ok:true});
  }
  if(action==="expected_income"){
    const r=await supabase.from("finance_expected_incomes").delete()
      .eq("id",id).eq("owner_user_id",user.id).select("id").maybeSingle();
    failDb(r.error);
    if(!r.data)throw new HttpError(404,"Previsão não encontrada.");
    return NextResponse.json({ok:true});
  }
  throw new HttpError(400,"Ação inválida.");
}
export async function POST(request:Request){try{return await add(request)}catch(error){return jsonError(error)}}
export async function PATCH(request:Request){try{return await change(request)}catch(error){return jsonError(error)}}
export async function DELETE(request:Request){try{return await remove(request)}catch(error){return jsonError(error)}}
