import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { HttpError, asObject, jsonError, requiredInteger, requiredString } from "@/lib/api/http";
import { requirePlatformAdmin } from "@/lib/auth/require-user";
import { summarizeAccounting } from "@/lib/accounting/calculations";
import { isFinanceCategory, suggestCategory } from "@/lib/accounting/categories";
import { buildInstallmentSchedule } from "@/lib/accounting/installments";
import { bankBoxActualBalances, forecastEvents, groupCardInvoices } from "@/lib/accounting/cash-flow";
import type { Card, CardPayment, CardAdjustment, ExpectedIncome } from "@/lib/accounting/cash-flow";
import type { Bank, CashBox, Entry, Origin, Period } from "@/lib/accounting/calculations";
import type { Database } from "@/lib/supabase/database.current.types";

type Client = Awaited<ReturnType<typeof requirePlatformAdmin>>["supabase"];
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(body: Record<string, unknown>, key: string) {
  const value = requiredString(body, key, 36);
  if (!idPattern.test(value)) throw new HttpError(400, "Identificador inválido: " + key);
  return value;
}
function date(body: Record<string, unknown>, key: string) {
  const value = requiredString(body, key, 10);
  if (!/^20\d\d-\d\d-\d\d$/.test(value)) throw new HttpError(400, "Data inválida: " + key);
  const parsed = new Date(value + "T12:00:00Z");
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value)
    throw new HttpError(400, "Data inválida: " + key);
  return value;
}
function monthParam(value: string | null) {
  if (!value || !/^20\d\d-(0[1-9]|1[0-2])$/.test(value)) {
    throw new HttpError(400, "Mês inválido.");
  }
  return value;
}
function fromDb(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (error.code === "23505") throw new HttpError(409, "Esse nome já está cadastrado.");
  if (error.code === "23503") throw new HttpError(400, "O banco, caixa ou origem selecionado não existe.");
  if (error.code === "23514") throw new HttpError(400, "Dados incompatíveis com as regras financeiras.");
  if (/Mes fechado|Existem contas pendentes|Fatura com pagamentos|pagamentos antes de alterar/.test(error.message)) throw new HttpError(409, error.message);
  throw error;
}
async function originFor(
  supabase: Client, owner: string, body: Record<string, unknown>,
): Promise<string | null> {
  if (body.originId) return uuid(body, "originId");
  if (!body.originName || typeof body.originName !== "string" || !body.originName.trim()) return null;
  const name = requiredString(body, "originName", 100);
  if (name.length < 2) throw new HttpError(400, "Origem muito curta.");
  const { data: existing, error: fetchError } = await supabase.from("finance_origins")
    .select("id,name").eq("owner_user_id", owner);
  fromDb(fetchError);
  const found = existing?.find((item) => item.name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"));
  if (found) return found.id;
  const inserted = await supabase.from("finance_origins")
    .insert({ owner_user_id: owner, name }).select("id").single();
  if (!inserted.error) return inserted.data.id;
  if (inserted.error.code === "23505") {
    const retry = await supabase.from("finance_origins").select("id,name").eq("owner_user_id", owner);
    fromDb(retry.error);
    const saved = retry.data?.find((item) => item.name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"));
    if (saved) return saved.id;
  }
  fromDb(inserted.error);
  return null;
}
function localParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const get = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
  return { date: get("year") + "-" + get("month") + "-" + get("day"),
    input: get("year") + "-" + get("month") + "-" + get("day") + "T" + get("hour") + ":" + get("minute") };
}
function parseMovement(body: Record<string, unknown>, status: Entry["status"]) {
  if (status === "pending") return { time: null, on: null };
  const value = body.movementAt;
  if (value !== undefined && value !== null && value !== "") {
    if (typeof value !== "string" || !/^20\d{2}-(0[1-9]|1[0-2])-[0-3]\dT[0-2]\d:[0-5]\d$/.test(value))
      throw new HttpError(400, "Data e hora inválidas.");
    const on = value.slice(0, 10);
    date({ on }, "on");
    const parsed = new Date(value + ":00-03:00");
    if (Number.isNaN(parsed.getTime()) || localParts(parsed).input !== value)
      throw new HttpError(400, "Data e hora inválidas.");
    return { time: parsed.toISOString(), on };
  }
  const suppliedDay = body.settledOn ? date(body, "settledOn") : null;
  const now = new Date();
  const on = suppliedDay ?? localParts(now).date;
  if (!suppliedDay || suppliedDay === localParts(now).date) {
    return { time: now.toISOString(), on };
  }
  return { time: new Date(on + "T12:00:00-03:00").toISOString(), on };
}
async function entryPayload(supabase: Client, owner: string, body: Record<string, unknown>) {
  const kind = requiredString(body, "kind", 20) as Entry["kind"];
  if (!["opening", "income", "expense", "transfer", "outflow"].includes(kind)) throw new HttpError(400, "Tipo inválido.");
  const cardId = body.cardId ? uuid(body,"cardId") : null;
  if (cardId && kind!=="expense") throw new HttpError(400, "Cartão só pode ser usado em despesas.");
  if (cardId && body.status==="paid")
    throw new HttpError(400, "Compras de cartão não são pagas individualmente. Registre o pagamento da fatura.");
  const status: Entry["status"] = kind === "expense" && (cardId || body.status === "pending") ? "pending" : "paid";
  let card: Card | null = null;
  if(cardId){
    const found=await supabase.from("finance_cards").select("*")
      .eq("owner_user_id",owner).eq("id",cardId).maybeSingle();
    fromDb(found.error);
    if(!found.data)throw new HttpError(404,"Cartão não encontrado.");
    if(!found.data.active)throw new HttpError(400,"Cartão inativo.");
    card=found.data;
  }
  const due = kind === "expense" ? date(body, "dueOn") : null;
  const movement = parseMovement(body, status);
  const entry: Database["public"]["Tables"]["finance_entries"]["Insert"] = {
    owner_user_id: owner,
    bank_id: card ? card.legacy_bank_id : uuid(body, "bankId"),
    card_id: cardId,
    box_id: uuid(body, "boxId"),
    kind,
    status,
    title: requiredString(body, "title", 160),
    category: kind==="expense" ? (isFinanceCategory(body.category) ? body.category
      : body.category==null ? suggestCategory(requiredString(body,"title",160))
      : (()=>{throw new HttpError(400,"Categoria inválida.");})()) : "outros",
    amount_cents: requiredInteger(body, "amountCents", 1),
    due_on: due,
    settled_on: movement.on,
    movement_at: movement.time,
    competence_month: (movement.on ?? due)!.slice(0, 7) + "-01",
    target_bank_id: kind === "transfer" ? uuid(body, "targetBankId") : null,
    target_box_id: kind === "transfer" ? uuid(body, "targetBoxId") : null,
    origin_id: kind === "transfer" ? null : await originFor(supabase, owner, body),
    notes: body.notes ? requiredString(body, "notes", 1000) : null,
  };
  if (kind === "transfer" && entry.bank_id === entry.target_bank_id && entry.box_id === entry.target_box_id)
    throw new HttpError(400, "Escolha um banco ou caixa de destino diferente.");
  if (entry.title!.length < 2) throw new HttpError(400, "Informe uma descrição maior.");
  return entry;
}
function installmentConfig(body: Record<string, unknown>) {
  const number = body.installmentNumber == null ? 1 : requiredInteger(body, "installmentNumber", 1);
  const total = body.installmentTotal == null ? 1 : requiredInteger(body, "installmentTotal", 1);
  if (total > 120 || number > total || (total === 1 && number !== 1))
    throw new HttpError(400, "Informe parcela atual e total entre 1 e 120.");
  return { number, total };
}

async function accountGet(request: Request) {
  const { supabase, user } = await requirePlatformAdmin();
  const url = new URL(request.url);
  const month = monthParam(url.searchParams.get("mes"));
  const [year,monthNumber]=month.split("-").map(Number);
  const previousMonth=new Date(Date.UTC(year,monthNumber-2,1)).toISOString().slice(0,7);
  const currentDay=localParts(new Date()).date;
  const [banks,boxes,origins,periods,cards,cardPayments,expectedIncomes,cardAdjustments] = await Promise.all([
    supabase.from("finance_banks").select("*").eq("owner_user_id",user.id).order("name"),
    supabase.from("finance_boxes").select("*").eq("owner_user_id",user.id).order("name"),
    supabase.from("finance_origins").select("*").eq("owner_user_id",user.id).order("name"),
    supabase.from("finance_periods").select("*").eq("owner_user_id",user.id).in("month",[month+"-01",previousMonth+"-01"]),
    supabase.from("finance_cards").select("*").eq("owner_user_id",user.id).order("name"),
    supabase.from("finance_card_payments").select("*").eq("owner_user_id",user.id).order("paid_at",{ascending:false}).limit(3000),
    supabase.from("finance_expected_incomes").select("*").eq("owner_user_id",user.id).order("expected_on").limit(3000),
    supabase.from("finance_card_adjustments").select("*").eq("owner_user_id",user.id).limit(3000),
  ]);
  [banks,boxes,origins,periods,cards,cardPayments,expectedIncomes,cardAdjustments].forEach(result=>fromDb(result.error));
  // Movimentacoes e saldo geral utilizam TODO o historico, sem filtro de competencia mensal.
  const entries:Entry[]=[];
  for(let offset=0;;offset+=500){
    const result=await supabase.from("finance_entries").select("*")
      .eq("owner_user_id",user.id)
      .order("created_at",{ascending:false}).order("id").range(offset,offset+499);
    fromDb(result.error);
    const batch=result.data??[];
    entries.push(...batch);
    if(batch.length<500)break;
  }
  const cardList=cards.data as Card[];
  const payments=cardPayments.data as CardPayment[];
  const receipts=expectedIncomes.data as ExpectedIncome[];
  const adjustments=cardAdjustments.data as CardAdjustment[];
  const invoices=groupCardInvoices(cardList,entries,payments,adjustments);
  const summary=summarizeAccounting(month,banks.data??[],boxes.data??[],entries,cardList,payments,receipts,adjustments);
  const position=bankBoxActualBalances(entries,payments,receipts,currentDay);
  const generalBalanceCents=Object.values(position).reduce((sum,cents)=>sum+cents,0);
  const events=forecastEvents(entries,invoices,receipts,currentDay);
  return NextResponse.json({
    banks:banks.data as Bank[],boxes:boxes.data as CashBox[],
    origins:origins.data as Origin[],
    period:(periods.data as Period[])?.find(p=>p.month===month+"-01")??null,
    previousMonth,
    previousPeriod:(periods.data as Period[])?.find(p=>p.month===previousMonth+"-01")??null,
    cards:cardList,cardPayments:payments,expectedIncomes:receipts,cardAdjustments:adjustments,
    invoices,ledgerEntries:entries.filter(e=>e.status==="paid"&&!e.card_id),
    generalBalanceCents,
    forecast:{today:currentDay,balances:position,events},
    ...summary,
  },{headers:{"Cache-Control":"private, no-store"}});
}

async function createRecord(request: Request) {
  const { supabase, user } = await requirePlatformAdmin();
  const body = asObject(await request.json());
  const action = requiredString(body, "action", 30);

  if (action === "bank" || action === "box" || action === "origin") {
    const name = requiredString(body, "name", 100);
    if (name.length < 2) throw new HttpError(400, "Nome muito curto.");
    if (action === "bank") {
      const result = await supabase.from("finance_banks").insert({ owner_user_id: user.id, name }).select("*").single();
      fromDb(result.error);
      return NextResponse.json({ record: result.data }, { status: 201 });
    }
    if (action === "box") {
      const kind = body.personType;
      if (kind !== "pf" && kind !== "pj") throw new HttpError(400, "Selecione pessoa física ou jurídica.");
      const result = await supabase.from("finance_boxes").insert({
        owner_user_id: user.id, name, person_type: kind,
      }).select("*").single();
      fromDb(result.error);
      return NextResponse.json({ record: result.data }, { status: 201 });
    }
    const result = await supabase.from("finance_origins").insert({ owner_user_id: user.id, name }).select("*").single();
    fromDb(result.error);
    return NextResponse.json({ record: result.data }, { status: 201 });
  }
  if (action === "entry") {
    const entry = await entryPayload(supabase, user.id, body);
    const { number, total } = entry.kind === "expense" ? installmentConfig(body) : { number: 1, total: 1 };
    if (total > 1) {
      // Um único INSERT é transacional: se qualquer mês estiver fechado, nenhuma parcela será criada.
      const seriesId = randomUUID();
      const due = entry.due_on!;
      const batch: Database["public"]["Tables"]["finance_entries"]["Insert"][] = [];
      for (const scheduled of buildInstallmentSchedule(due, number, total)) {
        const installment = scheduled.number;
        const first = installment === number;
        const installmentDue = scheduled.dueOn;
        batch.push({
          ...entry,
          due_on: installmentDue,
          status: first ? entry.status : "pending",
          settled_on: first ? entry.settled_on : null,
          movement_at: first ? entry.movement_at : null,
          competence_month: first && entry.status === "paid" ? entry.competence_month : installmentDue.slice(0, 7) + "-01",
          installment_series_id: seriesId,
          installment_number: installment,
          installment_total: total,
        });
      }
      const result = await supabase.from("finance_entries").insert(batch).select("id,installment_number");
      fromDb(result.error);
      return NextResponse.json({ records: result.data, count: batch.length }, { status: 201 });
    }
    const result = await supabase.from("finance_entries").insert(entry).select("*").single();
    fromDb(result.error);
    return NextResponse.json({ record: result.data }, { status: 201 });
  }
  if (action === "setup") {
    // Apenas cadastros iniciais, sem inventar saldos ou lançamentos.
    const bankNames = ["Inter", "Mercado Pago", "Sicredi"];
    const boxNames = [
      { name: "Leandro", person_type: "pf" as const },
      { name: "CRM", person_type: "pj" as const },
      { name: "Lucas", person_type: "pf" as const },
      { name: "Sonia", person_type: "pf" as const },
      { name: "Prosperity Pay", person_type: "pj" as const },
    ];
    const [existingBanks, existingBoxes] = await Promise.all([
      supabase.from("finance_banks").select("name").eq("owner_user_id", user.id),
      supabase.from("finance_boxes").select("name").eq("owner_user_id", user.id),
    ]);
    fromDb(existingBanks.error); fromDb(existingBoxes.error);
    for (const name of bankNames) {
      if (existingBanks.data?.some((item) => item.name.toLowerCase() === name.toLowerCase())) continue;
      const result = await supabase.from("finance_banks").insert({ owner_user_id: user.id, name });
      if (result.error?.code !== "23505") fromDb(result.error);
    }
    for (const box of boxNames) {
      if (existingBoxes.data?.some((item) => item.name.toLowerCase() === box.name.toLowerCase())) continue;
      const result = await supabase.from("finance_boxes").insert({ owner_user_id: user.id, ...box });
      if (result.error?.code !== "23505") fromDb(result.error);
    }
    return NextResponse.json({ ok: true });
  }
  throw new HttpError(400, "Ação não suportada.");
}

/**
 * Alteração pontual para a planilha: somente um campo por vez e com checagem
 * de versão, sem regravar observações, horário ou parcelas de outras células.
 * Respeita os gatilhos de mês fechado e de faturas com pagamento.
 */
async function quickEditEntry(supabase: Client, owner: string, body: Record<string, unknown>) {
  const id = uuid(body, "id");
  const updatedAt = requiredString(body,"updatedAt",50);
  const field = requiredString(body,"field",30);
  const result = await supabase.from("finance_entries").select("*")
    .eq("owner_user_id",owner).eq("id",id).maybeSingle();
  fromDb(result.error);
  const original=result.data;
  if (!original) throw new HttpError(404,"Conta não encontrada.");
  if (original.kind!=="expense") throw new HttpError(400,"A edição rápida é exclusiva da planilha de contas.");
  if (original.updated_at!==updatedAt) throw new HttpError(409,"Esta conta foi alterada em outra operação. Atualize a planilha.");
  const changes:Database["public"]["Tables"]["finance_entries"]["Update"]={};
  if(field==="originId"){
    changes.origin_id=body.value?uuid({originId:body.value},"originId"):null;
  } else if(field==="category"){
    if(!isFinanceCategory(body.value))throw new HttpError(400,"Categoria inválida.");
    changes.category=body.value;
  } else if(field==="title"){
    changes.title=requiredString({title:body.value},"title",160);
    if(changes.title.trim().length<2)throw new HttpError(400,"Descrição muito curta.");
  } else if(field==="amountCents"){
    const amount=requiredInteger({amountCents:body.value},"amountCents",1);
    if(amount>999999999999)throw new HttpError(400,"Valor muito alto.");
    changes.amount_cents=amount;
  } else if(field==="boxId"){
    changes.box_id=uuid({boxId:body.value},"boxId");
    const box=await supabase.from("finance_boxes").select("active")
      .eq("owner_user_id",owner).eq("id",changes.box_id).maybeSingle();
    fromDb(box.error);
    if(!box.data?.active && changes.box_id!==original.box_id)
      throw new HttpError(400,"Caixa inativo ou não encontrado.");
  } else if(field==="dueOn"){
    changes.due_on=date({dueOn:body.value},"dueOn");
    if(original.status==="pending")changes.competence_month=changes.due_on.slice(0,7)+"-01";
  } else if(field==="paymentSource"){
    if(typeof body.value!=="string" || !/^(bank|card):[0-9a-f-]{36}$/i.test(body.value))
      throw new HttpError(400,"Banco ou cartão inválido.");
    const [kind,identifier]=body.value.split(":");
    if(!idPattern.test(identifier))throw new HttpError(400,"Identificador inválido.");
    if(kind==="card"){
      if(original.status==="paid")
        throw new HttpError(409,"Para converter uma conta já paga em compra de cartão, estorne o pagamento no editor completo.");
      const card=await supabase.from("finance_cards").select("id,active,legacy_bank_id,due_day")
        .eq("owner_user_id",owner).eq("id",identifier).maybeSingle();
      fromDb(card.error);
      if(!card.data?.active)throw new HttpError(400,"Cartão inativo ou não encontrado.");
      changes.card_id=card.data.id;
      changes.bank_id=card.data.legacy_bank_id;
      const due=original.due_on;
      if(!due)throw new HttpError(400,"A conta precisa de vencimento.");
      const [year,month]=due.split("-").map(Number);
      const maxDay=new Date(Date.UTC(year,month,0)).getUTCDate();
      changes.due_on=due.slice(0,7)+"-"+String(Math.min(card.data.due_day,maxDay)).padStart(2,"0");
      changes.competence_month=changes.due_on.slice(0,7)+"-01";
    } else {
      const bank=await supabase.from("finance_banks").select("id,active")
        .eq("owner_user_id",owner).eq("id",identifier).maybeSingle();
      fromDb(bank.error);
      if(!bank.data?.active && identifier!==original.bank_id)
        throw new HttpError(400,"Banco inativo ou não encontrado.");
      changes.bank_id=identifier;
      changes.card_id=null;
    }
  } else if(field==="status"){
    if(original.card_id)throw new HttpError(400,"Compras de cartão são quitadas pela fatura.");
    if(body.value!=="paid"&&body.value!=="pending")
      throw new HttpError(400,"Situação inválida.");
    if(body.value==="paid"&&original.status==="pending"){
      const now=new Date();
      const current=localParts(now).date;
      changes.status="paid";
      changes.settled_on=current;
      changes.movement_at=now.toISOString();
      changes.competence_month=current.slice(0,7)+"-01";
    } else if(body.value==="pending"&&original.status==="paid"){
      changes.status="pending";
      changes.settled_on=null;
      changes.movement_at=null;
      changes.competence_month=original.due_on!.slice(0,7)+"-01";
    } else return NextResponse.json({record:original});
  } else throw new HttpError(400,"Campo não permitido para edição rápida.");
  const updated=await supabase.from("finance_entries").update(changes)
    .eq("id",id).eq("owner_user_id",owner).eq("updated_at",updatedAt)
    .select("*").maybeSingle();
  fromDb(updated.error);
  if(!updated.data)throw new HttpError(409,"A conta mudou durante a edição. Atualize a planilha.");
  return NextResponse.json({record:updated.data});
}

async function modifyRecord(request: Request) {
  const { supabase, user } = await requirePlatformAdmin();
  const body = asObject(await request.json());
  const action = requiredString(body, "action", 30);
  if (action === "period") {
    const month = monthParam(requiredString(body, "month", 7));
    const status = body.status;
    if (status !== "open" && status !== "closed") throw new HttpError(400, "Status de fechamento inválido.");
    const result = await supabase.from("finance_periods").upsert({
      owner_user_id: user.id, month: month + "-01", status,
    }, { onConflict: "owner_user_id,month" }).select("*").single();
    fromDb(result.error);
    return NextResponse.json({ period: result.data });
  }
  if (action === "quick_entry") return quickEditEntry(supabase,user.id,body);
  if (action === "entry") {
    const id = uuid(body, "id");
    const payload = await entryPayload(supabase, user.id, body);
    // O mês antigo e o novo são protegidos pelo gatilho transacional do banco.
    const result = await supabase.from("finance_entries").update(payload)
      .eq("id", id).eq("owner_user_id", user.id).select("*").maybeSingle();
    fromDb(result.error);
    if (!result.data) throw new HttpError(404, "Lançamento não encontrado.");
    return NextResponse.json({ record: result.data });
  }
  if (action === "bank" || action === "box" || action === "origin") {
    const id = uuid(body, "id");
    const name = requiredString(body, "name", 100);
    if (name.length < 2) throw new HttpError(400, "Nome muito curto.");
    if (action === "bank") {
      const result = await supabase.from("finance_banks").update({
        name, active: body.active !== false,
      }).eq("id", id).eq("owner_user_id", user.id).select("*").maybeSingle();
      fromDb(result.error);
      if (!result.data) throw new HttpError(404, "Banco não encontrado.");
      return NextResponse.json({ record: result.data });
    }
    if (action === "box") {
      if (body.personType !== "pf" && body.personType !== "pj") throw new HttpError(400, "Tipo de pessoa inválido.");
      const result = await supabase.from("finance_boxes").update({
        name, person_type: body.personType, active: body.active !== false,
      }).eq("id", id).eq("owner_user_id", user.id).select("*").maybeSingle();
      fromDb(result.error);
      if (!result.data) throw new HttpError(404, "Caixa não encontrado.");
      return NextResponse.json({ record: result.data });
    }
    const result = await supabase.from("finance_origins").update({ name })
      .eq("id", id).eq("owner_user_id", user.id).select("*").maybeSingle();
    fromDb(result.error);
    if (!result.data) throw new HttpError(404, "Origem não encontrada.");
    return NextResponse.json({ record: result.data });
  }
  throw new HttpError(400, "Ação não suportada.");
}

async function deleteRecord(request: Request) {
  const { supabase, user } = await requirePlatformAdmin();
  const body = asObject(await request.json());
  const id = uuid(body, "id");
  const action = body.action;
  if (action === "bank" || action === "box") {
    // Chaves estrangeiras sem cascata preservam o histórico contábil.
    const table = action === "bank" ? "finance_banks" : "finance_boxes";
    const result = await supabase.from(table).delete()
      .eq("id", id).eq("owner_user_id", user.id).select("id").maybeSingle();
    if (result.error?.code === "23503")
      throw new HttpError(409, "Este " + (action === "bank" ? "banco" : "caixa") +
        " possui lançamentos vinculados e não pode ser apagado. Desative-o para preservar o histórico.");
    fromDb(result.error);
    if (!result.data) throw new HttpError(404, "Cadastro não encontrado.");
    return NextResponse.json({ ok: true });
  }
  if (action !== "entry" && action !== undefined)
    throw new HttpError(400, "Ação inválida.");
  const result = await supabase.from("finance_entries").delete()
    .eq("id", id).eq("owner_user_id", user.id).select("id").maybeSingle();
  fromDb(result.error);
  if (!result.data) throw new HttpError(404, "Lançamento não encontrado.");
  return NextResponse.json({ ok: true });
}

export async function GET(request: Request) { try { return await accountGet(request); } catch (error) { return jsonError(error); } }
export async function POST(request: Request) { try { return await createRecord(request); } catch (error) { return jsonError(error); } }
export async function PATCH(request: Request) { try { return await modifyRecord(request); } catch (error) { return jsonError(error); } }
export async function DELETE(request: Request) { try { return await deleteRecord(request); } catch (error) { return jsonError(error); } }
