import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { HttpError, asObject, jsonError, requiredInteger, requiredString } from "@/lib/api/http";
import { requirePlatformAdmin } from "@/lib/auth/require-user";
import { summarizeAccounting } from "@/lib/accounting/calculations";
import { buildInstallmentSchedule } from "@/lib/accounting/installments";
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
  if (/Mes fechado|Existem contas pendentes/.test(error.message)) throw new HttpError(409, error.message);
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
    if (typeof value !== "string" || !/^20\\d{2}-(0[1-9]|1[0-2])-[0-3]\\dT[0-2]\\d:[0-5]\\d$/.test(value))
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
  if (!["opening", "income", "expense", "transfer"].includes(kind)) throw new HttpError(400, "Tipo inválido.");
  const status: Entry["status"] = kind === "expense" && body.status === "pending" ? "pending" : "paid";
  const due = kind === "expense" ? date(body, "dueOn") : null;
  const movement = parseMovement(body, status);
  const entry: Database["public"]["Tables"]["finance_entries"]["Insert"] = {
    owner_user_id: owner,
    bank_id: uuid(body, "bankId"),
    box_id: uuid(body, "boxId"),
    kind,
    status,
    title: requiredString(body, "title", 160),
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
  const [banks, boxes, origins, periods] = await Promise.all([
    supabase.from("finance_banks").select("*").eq("owner_user_id", user.id).order("name"),
    supabase.from("finance_boxes").select("*").eq("owner_user_id", user.id).order("name"),
    supabase.from("finance_origins").select("*").eq("owner_user_id", user.id).order("name"),
    supabase.from("finance_periods").select("*").eq("owner_user_id", user.id).eq("month", month + "-01"),
  ]);
  [banks, boxes, origins, periods].forEach((item) => fromDb(item.error));
  const entries: Entry[] = [];
  // Paginação completa: o saldo histórico nunca depende de um LIMIT arbitrário.
  for (let offset = 0; ; offset += 500) {
    const result = await supabase.from("finance_entries").select("*")
      .eq("owner_user_id", user.id).lte("competence_month", month + "-01")
      .order("created_at", { ascending: false }).order("id")
      .range(offset, offset + 499);
    fromDb(result.error);
    const batch = result.data ?? [];
    entries.push(...batch);
    if (batch.length < 500) break;
  }
  const summary = summarizeAccounting(month, banks.data ?? [], boxes.data ?? [], entries);
  return NextResponse.json({
    banks: banks.data as Bank[], boxes: boxes.data as CashBox[],
    origins: origins.data as Origin[], period: (periods.data as Period[])?.[0] ?? null,
    ...summary,
  }, { headers: { "Cache-Control": "private, no-store" } });
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
