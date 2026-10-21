import { ensureInitialPlatformAdmin, requireUser } from "@/lib/auth/require-user";
import {
  CASH_TIME_ZONE,
  isSalesCashPreset,
  resolveSalesCashPreset,
  type SalesCashPreset,
  type SalesCashRangeFields,
} from "@/lib/sales/cash-control-presets";
import { createAdminClient } from "@/lib/supabase/admin";

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
  filters: SalesCashRangeFields & {
    preset: SalesCashPreset;
  };
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

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function validFields(input: Partial<SalesCashRangeFields>) {
  return Boolean(
    input.startDate &&
      DATE_PATTERN.test(input.startDate) &&
      input.endDate &&
      DATE_PATTERN.test(input.endDate) &&
      input.startTime &&
      TIME_PATTERN.test(input.startTime) &&
      input.endTime &&
      TIME_PATTERN.test(input.endTime),
  );
}

function timeZoneOffsetMs(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CASH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const representedAsUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour"),
    read("minute"),
    read("second"),
  );
  return representedAsUtc - date.getTime();
}

function saoPauloWallTimeToUtc(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, 0);
  const guess = new Date(wallClock);
  const firstOffset = timeZoneOffsetMs(guess);
  let resolved = new Date(wallClock - firstOffset);
  const secondOffset = timeZoneOffsetMs(resolved);
  if (secondOffset !== firstOffset) {
    resolved = new Date(wallClock - secondOffset);
  }
  return resolved;
}

export async function getSalesCashControlView(input: {
  preset?: string;
  startDate?: string;
  startTime?: string;
  endDate?: string;
  endTime?: string;
}): Promise<SalesCashControlView> {
  const { user } = await requireUser();
  const isPlatformAdmin = await ensureInitialPlatformAdmin(user.id);
  const preset = isSalesCashPreset(input.preset)
    ? input.preset
    : "current_month";

  const submittedFields = {
    startDate: input.startDate,
    startTime: input.startTime,
    endDate: input.endDate,
    endTime: input.endTime,
  };
  const fields = validFields(submittedFields)
    ? (submittedFields as SalesCashRangeFields)
    : resolveSalesCashPreset(
        preset === "custom" ? "current_month" : preset,
        new Date(),
      );

  const startAt = saoPauloWallTimeToUtc(fields.startDate, fields.startTime);
  const endAtInclusiveMinute = saoPauloWallTimeToUtc(
    fields.endDate,
    fields.endTime,
  );
  const endAt = new Date(endAtInclusiveMinute.getTime() + 60_000);

  if (
    !Number.isFinite(startAt.getTime()) ||
    !Number.isFinite(endAt.getTime()) ||
    endAt <= startAt
  ) {
    throw new Error("Intervalo de datas inválido.");
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc(
    "get_sales_cash_control_range_totals",
    {
      target_user_id: user.id,
      target_start_at: startAt.toISOString(),
      target_end_at: endAt.toISOString(),
    },
  );

  if (error) throw error;

  return {
    totals: data?.[0] ?? EMPTY_TOTALS,
    isPlatformAdmin,
    filters: {
      preset: validFields(submittedFields) ? preset : "current_month",
      ...fields,
    },
  };
}
