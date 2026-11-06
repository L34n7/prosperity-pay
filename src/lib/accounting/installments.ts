/**
 * Gera datas de parcelas a partir do vencimento original.
 * Usa sempre o dia original (ex.: 31/01 -> 28/02 -> 31/03)
 * e não o dia já ajustado no mês anterior.
 */
export function shiftMonthlyDate(isoDate: string, offset: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match || !Number.isSafeInteger(offset) || offset < 0 || offset > 120)
    throw new Error("Data ou parcela inválida.");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText), month = Number(monthText), day = Number(dayText);
  const initial = new Date(Date.UTC(year, month - 1, day));
  if (initial.getUTCFullYear() !== year || initial.getUTCMonth() !== month - 1 || initial.getUTCDate() !== day)
    throw new Error("Vencimento inválido.");
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const y = first.getUTCFullYear(), m = first.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return String(y).padStart(4, "0") + "-" + String(m).padStart(2, "0") + "-" +
    String(Math.min(day, lastDay)).padStart(2, "0");
}

export function buildInstallmentSchedule(dueOn: string, first: number, total: number) {
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(total) ||
      first < 1 || first > total || total > 120) throw new Error("Parcelamento inválido.");
  return Array.from({length: total - first + 1}, (_, index) => ({
    number: first + index, dueOn: shiftMonthlyDate(dueOn, index),
  }));
}
