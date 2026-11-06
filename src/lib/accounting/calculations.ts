import type { Database } from "@/lib/supabase/database.current.types";
import { brazilDate, groupCardInvoices } from "./cash-flow";
import type { Card, CardPayment, CardAdjustment, ExpectedIncome } from "./cash-flow";

export type Bank = Database["public"]["Tables"]["finance_banks"]["Row"];
export type CashBox = Database["public"]["Tables"]["finance_boxes"]["Row"];
export type Origin = Database["public"]["Tables"]["finance_origins"]["Row"];
export type Entry = Database["public"]["Tables"]["finance_entries"]["Row"];
export type Period = Database["public"]["Tables"]["finance_periods"]["Row"];

export type MonthlySnapshot = ReturnType<typeof summarizeAccounting>;

function increment(map: Record<string, number>, key: string, amount: number) {
  map[key] = (map[key] ?? 0) + amount;
}

export function summarizeAccounting(
  month: string,
  banks: Bank[],
  boxes: CashBox[],
  entries: Entry[],
  cards: Card[] = [],
  cardPayments: CardPayment[] = [],
  expectedIncomes: ExpectedIncome[] = [],
  adjustments: CardAdjustment[] = [],
) {
  const selected = month + "-01";
  const bankBalances: Record<string, number> = {};
  const boxBalances: Record<string, number> = {};
  const matrix: Record<string, number> = {};
  const bankOpening: Record<string, number> = {};
  const boxOpening: Record<string, number> = {};
  const originExpenses: Record<string, number> = {};
  for (const bank of banks) { bankBalances[bank.id] = 0; bankOpening[bank.id] = 0; }
  for (const box of boxes) { boxBalances[box.id] = 0; boxOpening[box.id] = 0; }

  let received = 0;
  let paid = 0;
  let pending = 0;
  let transferred = 0;
  let opening = 0;
  const monthEntries: Entry[] = [];
  const titles = new Map<string, Pick<Entry, "title" | "bank_id" | "box_id" | "origin_id">>();

  for (const entry of entries) {
    if (entry.kind === "expense" && !titles.has(entry.title.trim().toLocaleLowerCase("pt-BR"))) {
      titles.set(entry.title.trim().toLocaleLowerCase("pt-BR"), {
        title: entry.title, bank_id: entry.bank_id, box_id: entry.box_id, origin_id: entry.origin_id,
      });
    }
    if (entry.competence_month > selected) continue;
    const isCurrent = entry.competence_month === selected;
    if (isCurrent) monthEntries.push(entry);
    if (entry.status === "pending") {
      if (isCurrent && entry.kind === "expense" && !entry.card_id) pending += entry.amount_cents;
      continue;
    }
    if (entry.card_id) continue;

    const effects: Array<{ bank: string; box: string; amount: number }> = [];
    if (entry.kind === "transfer") {
      effects.push({ bank: entry.bank_id, box: entry.box_id, amount: -entry.amount_cents });
      effects.push({ bank: entry.target_bank_id!, box: entry.target_box_id!, amount: entry.amount_cents });
      if (isCurrent) transferred += entry.amount_cents;
    } else {
      const signed = entry.kind === "expense" ? -entry.amount_cents : entry.amount_cents;
      effects.push({ bank: entry.bank_id, box: entry.box_id, amount: signed });
      if (isCurrent) {
        if (entry.kind === "expense") {
          paid += entry.amount_cents;
          if (entry.origin_id) increment(originExpenses, entry.origin_id, entry.amount_cents);
        } else if (entry.kind === "opening") opening += entry.amount_cents;
        else received += entry.amount_cents;
      }
    }
    for (const effect of effects) {
      increment(bankBalances, effect.bank, effect.amount);
      increment(boxBalances, effect.box, effect.amount);
      increment(matrix, effect.bank + ":" + effect.box, effect.amount);
      if (!isCurrent) {
        increment(bankOpening, effect.bank, effect.amount);
        increment(boxOpening, effect.box, effect.amount);
      }
    }
  }
  // Cartao e passivo, nao banco. O pagamento da fatura e a unica saida real.
  for (const payment of cardPayments) {
    const date = brazilDate(payment.paid_at);
    if (date.slice(0,7)>month) continue;
    increment(bankBalances,payment.bank_id,-payment.amount_cents);
    increment(boxBalances,payment.box_id,-payment.amount_cents);
    increment(matrix,payment.bank_id+":"+payment.box_id,-payment.amount_cents);
    if(date.slice(0,7)===month)paid+=payment.amount_cents;
    else {
      increment(bankOpening,payment.bank_id,-payment.amount_cents);
      increment(boxOpening,payment.box_id,-payment.amount_cents);
    }
  }
  for(const receipt of expectedIncomes) {
    if(receipt.status!=="received"||!receipt.received_at)continue;
    const date=brazilDate(receipt.received_at);
    if(date.slice(0,7)>month)continue;
    increment(bankBalances,receipt.bank_id,receipt.amount_cents);
    increment(boxBalances,receipt.box_id,receipt.amount_cents);
    increment(matrix,receipt.bank_id+":"+receipt.box_id,receipt.amount_cents);
    if(date.slice(0,7)===month)received+=receipt.amount_cents;
    else {
      increment(bankOpening,receipt.bank_id,receipt.amount_cents);
      increment(boxOpening,receipt.box_id,receipt.amount_cents);
    }
  }
  const invoices=groupCardInvoices(cards,entries,cardPayments,adjustments);
  pending+=invoices.filter(i=>i.invoice_month===selected).reduce((sum,i)=>sum+i.remaining_cents,0);
  const balance = Object.values(bankBalances).reduce((sum, item) => sum + item, 0);
  const initialBalance = Object.values(bankOpening).reduce((sum, item) => sum + item, 0);
  return {
    month,
    bankBalances, boxBalances, matrix, bankOpening, boxOpening, originExpenses,
    totals: { balance, initialBalance, received, paid, pending, transferred, opening },
    monthEntries: monthEntries.sort((a, b) => b.created_at.localeCompare(a.created_at)),
    suggestions: [...titles.values()].slice(0, 100),
  };
}
