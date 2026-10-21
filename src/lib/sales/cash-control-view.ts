import { ensureInitialPlatformAdmin, requireUser } from "@/lib/auth/require-user";

const CASH_TIME_ZONE = "America/Sao_Paulo";

export type SalesCashControlTotals = {
  sales_count: number;
  volume_cents: number;
  product_revenue_cents: number;
  ticket_average_cents: number;
  available_cents: number;
  pending_cents: number;
  withdrawals_cents: number;
  prosperity_fee_cents: number;
  provider_fee_cents: number;
  affiliate_commission_cents: number;
  accredited_commission_cents: number;
  coproducer_commission_cents: number;
  total_commission_cents: number;
};

export type SalesCashControlView = {
  totals: SalesCashControlTotals;
  isPlatformAdmin: boolean;
  filters: {
    month: string;
    day: number | null;
    hour: number | null;
  };
  daysInMonth: number;
};

const EMPTY_TOTALS: SalesCashControlTotals = {
  sales_count: 0,
  volume_cents: 0,
  product_revenue_cents: 0,
  ticket_average_cents: 0,
  available_cents: 0,
  pending_cents: 0,
  withdrawals_cents: 0,
  prosperity_fee_cents: 0,
  provider_fee_cents: 0,
  affiliate_commission_cents: 0,
  accredited_commission_cents: 0,
  coproducer_commission_cents: 0,
  total_commission_cents: 0,
};

function currentMonthInSaoPaulo(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CASH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return year && month ? `${year}-${month}` : now.toISOString().slice(0, 7);
}

function normalizeMonth(value?: string) {
  return value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
    ? value
    : currentMonthInSaoPaulo();
}

function daysInMonth(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function optionalInteger(value: string | undefined, min: number, max: number) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export async function getSalesCashControlView(input: {
  month?: string;
  day?: string;
  hour?: string;
}): Promise<SalesCashControlView> {
  const { user, supabase } = await requireUser();
  const isPlatformAdmin = await ensureInitialPlatformAdmin(user.id);
  const month = normalizeMonth(input.month);
  const monthDays = daysInMonth(month);
  const day = optionalInteger(input.day, 1, monthDays);
  const hour = optionalInteger(input.hour, 0, 23);

  const { data, error } = await supabase.rpc("get_sales_cash_control_totals", {
    target_month: `${month}-01`,
    target_day: day,
    target_hour: hour,
  });

  if (error) throw error;

  return {
    totals: data?.[0] ?? EMPTY_TOTALS,
    isPlatformAdmin,
    filters: { month, day, hour },
    daysInMonth: monthDays,
  };
}
