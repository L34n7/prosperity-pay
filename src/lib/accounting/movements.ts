import type { Entry } from "./calculations";
import type { Card, CardPayment, ExpectedIncome } from "./cash-flow";
import { brazilDate } from "./cash-flow";

export type MovementKind =
  | "income" | "outflow" | "transfer" | "opening" | "bill_payment" | "card_payment";
export type MovementSource = "ledger" | "card_payment" | "expected_income";
export type BankMovement = {
  id: string;
  source: MovementSource;
  kind: MovementKind;
  title: string;
  date: string;
  timestamp: string | null;
  bank_id: string;
  box_id: string;
  target_bank_id: string | null;
  target_box_id: string | null;
  amount_cents: number;
  notes: string | null;
  entry_id: string | null;
  hour_is_estimated: boolean;
};

export function collectBankMovements(
  entries: Entry[],
  cardPayments: CardPayment[],
  expectedIncomes: ExpectedIncome[],
  cards: Card[],
): BankMovement[] {
  const cardNames = new Map(cards.map(c => [c.id, c.name]));
  const movements: BankMovement[] = [];

  for (const e of entries) {
    // Compras de cartao nao sao movimentacoes de banco e previsoes nunca entram no extrato.
    if (e.status !== "paid" || e.card_id || !e.settled_on) continue;
    const kind: MovementKind = e.kind === "expense" ? "bill_payment" : e.kind;
    const timestamp = e.movement_at ?? null;
    const date = timestamp ? brazilDate(timestamp) : e.settled_on;
    movements.push({
      id: "ledger:" + e.id,
      source: "ledger",
      kind,
      title: e.title,
      date,
      timestamp,
      bank_id: e.bank_id,
      box_id: e.box_id,
      target_bank_id: e.target_bank_id,
      target_box_id: e.target_box_id,
      amount_cents: e.amount_cents,
      notes: e.notes,
      entry_id: e.id,
      hour_is_estimated: /Horário não informado|hora 12h PROVISÓRIAS|horário técnico|horário não informado/i.test(e.notes ?? ""),
    });
  }

  for (const p of cardPayments) {
    movements.push({
      id: "card-payment:" + p.id,
      source: "card_payment",
      kind: "card_payment",
      title: "Pagamento de fatura · " + (cardNames.get(p.card_id) ?? "Cartão"),
      date: brazilDate(p.paid_at),
      timestamp: p.paid_at,
      bank_id: p.bank_id,
      box_id: p.box_id,
      target_bank_id: null,
      target_box_id: null,
      amount_cents: p.amount_cents,
      notes: p.notes,
      entry_id: null,
      hour_is_estimated: false,
    });
  }

  for (const r of expectedIncomes) {
    if (r.status !== "received" || !r.received_at) continue;
    movements.push({
      id: "expected-income:" + r.id,
      source: "expected_income",
      kind: "income",
      title: r.title,
      date: brazilDate(r.received_at),
      timestamp: r.received_at,
      bank_id: r.bank_id,
      box_id: r.box_id,
      target_bank_id: null,
      target_box_id: null,
      amount_cents: r.amount_cents,
      notes: r.notes,
      entry_id: null,
      hour_is_estimated: false,
    });
  }

  return movements.sort((a, b) =>
    b.date.localeCompare(a.date) ||
    (b.timestamp ?? "").localeCompare(a.timestamp ?? "") ||
    b.id.localeCompare(a.id)
  );
}

export type MovementFilter = {
  start: string;
  end: string;
  kind: MovementKind | "all";
  bankId: string;
  boxId: string;
  search: string;
};

export function filterBankMovements(rows: BankMovement[], filters: MovementFilter): BankMovement[] {
  const search = filters.search.trim().toLocaleLowerCase("pt-BR");
  return rows.filter(m => {
    if (m.date < filters.start || m.date > filters.end) return false;
    if (filters.kind !== "all" && m.kind !== filters.kind) return false;
    if (filters.bankId || filters.boxId) {
      const sourceMatch = (!filters.bankId || m.bank_id === filters.bankId) &&
        (!filters.boxId || m.box_id === filters.boxId);
      const targetMatch = m.kind === "transfer" &&
        (!filters.bankId || m.target_bank_id === filters.bankId) &&
        (!filters.boxId || m.target_box_id === filters.boxId);
      if (!sourceMatch && !targetMatch) return false;
    }
    if (search && ![m.title, m.notes ?? ""].some(v => v.toLocaleLowerCase("pt-BR").includes(search))) return false;
    return true;
  });
}

export function movementSignedAmount(
  movement: BankMovement,
  bankId = "",
  boxId = "",
): number {
  if (movement.kind === "transfer") {
    const matchesSource = (!bankId || movement.bank_id === bankId) && (!boxId || movement.box_id === boxId);
    const matchesTarget = (!bankId || movement.target_bank_id === bankId) && (!boxId || movement.target_box_id === boxId);
    return (matchesTarget ? movement.amount_cents : 0) -
      (matchesSource ? movement.amount_cents : 0);
  }
  return (movement.kind === "income" || movement.kind === "opening" ? 1 : -1) * movement.amount_cents;
}

export function sumMovements(rows: BankMovement[], bankId = "", boxId = "") {
  let inCents = 0, outCents = 0, transferCents = 0;
  for (const row of rows) {
    const signed = movementSignedAmount(row,bankId,boxId);
    if (signed > 0) inCents += signed;
    if (signed < 0) outCents += -signed;
    if (row.kind === "transfer") transferCents += row.amount_cents;
  }
  return { inCents, outCents, transferCents, netCents: inCents - outCents, count: rows.length };
}

export function shiftReportDay(day: string, offset: number): string {
  const date = new Date(day + "T12:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0,10);
}

export function reportMonthBounds(month: string) {
  const first = month + "-01";
  const [y,m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y,m,0)).getUTCDate();
  return {start:first, end:month+"-"+String(last).padStart(2,"0")};
}
