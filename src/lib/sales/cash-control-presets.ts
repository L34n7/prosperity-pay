export const CASH_TIME_ZONE = "America/Sao_Paulo";

export const SALES_CASH_PRESETS = [
  { value: "current_month", label: "Mês atual" },
  { value: "previous_month", label: "Mês passado" },
  { value: "two_months_ago", label: "Mês retrasado" },
  { value: "rolling_6_months", label: "Últimos 6 meses" },
  { value: "rolling_3_months", label: "Últimos 3 meses" },
  { value: "rolling_1_month", label: "Último 1 mês" },
  { value: "last_15_days", label: "Últimos 15 dias" },
  { value: "last_10_days", label: "Últimos 10 dias" },
  { value: "last_7_days", label: "Última 1 semana" },
  { value: "today", label: "Dia atual" },
  { value: "last_24_hours", label: "Últimas 24 horas" },
  { value: "last_12_hours", label: "Últimas 12 horas" },
  { value: "last_hour", label: "Última hora" },
] as const;

export type SalesCashPreset =
  | (typeof SALES_CASH_PRESETS)[number]["value"]
  | "custom";

export type SalesCashRangeFields = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

type WallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const SAO_PAULO_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: CASH_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function wallNow(now: Date): WallTime {
  const parts = SAO_PAULO_FORMATTER.formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

function surrogate(value: WallTime) {
  return new Date(
    Date.UTC(
      value.year,
      value.month - 1,
      value.day,
      value.hour,
      value.minute,
    ),
  );
}

function wallFromSurrogate(value: Date): WallTime {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
    hour: value.getUTCHours(),
    minute: value.getUTCMinutes(),
  };
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function shiftMonths(value: WallTime, months: number) {
  const totalMonths = value.year * 12 + (value.month - 1) + months;
  const year = Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12 + 1;
  return {
    ...value,
    year,
    month,
    day: Math.min(value.day, daysInMonth(year, month)),
  };
}

function shiftDuration(value: WallTime, milliseconds: number) {
  return wallFromSurrogate(new Date(surrogate(value).getTime() + milliseconds));
}

function firstOfMonth(value: WallTime) {
  return { ...value, day: 1, hour: 0, minute: 0 };
}

function fullMonth(value: WallTime, monthOffset: number) {
  const target = shiftMonths(firstOfMonth(value), monthOffset);
  return {
    start: target,
    end: {
      ...target,
      day: daysInMonth(target.year, target.month),
      hour: 23,
      minute: 59,
    },
  };
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function fields(start: WallTime, end: WallTime): SalesCashRangeFields {
  return {
    startDate: `${start.year}-${pad(start.month)}-${pad(start.day)}`,
    startTime: `${pad(start.hour)}:${pad(start.minute)}`,
    endDate: `${end.year}-${pad(end.month)}-${pad(end.day)}`,
    endTime: `${pad(end.hour)}:${pad(end.minute)}`,
  };
}

export function resolveSalesCashPreset(
  preset: SalesCashPreset,
  now = new Date(),
): SalesCashRangeFields {
  const current = wallNow(now);

  if (preset === "previous_month") {
    const range = fullMonth(current, -1);
    return fields(range.start, range.end);
  }
  if (preset === "two_months_ago") {
    const range = fullMonth(current, -2);
    return fields(range.start, range.end);
  }
  if (preset === "rolling_6_months") {
    return fields(shiftMonths(current, -6), current);
  }
  if (preset === "rolling_3_months") {
    return fields(shiftMonths(current, -3), current);
  }
  if (preset === "rolling_1_month") {
    return fields(shiftMonths(current, -1), current);
  }
  if (preset === "last_15_days") {
    return fields(shiftDuration(current, -15 * 86_400_000), current);
  }
  if (preset === "last_10_days") {
    return fields(shiftDuration(current, -10 * 86_400_000), current);
  }
  if (preset === "last_7_days") {
    return fields(shiftDuration(current, -7 * 86_400_000), current);
  }
  if (preset === "today") {
    return fields({ ...current, hour: 0, minute: 0 }, current);
  }
  if (preset === "last_24_hours") {
    return fields(shiftDuration(current, -24 * 3_600_000), current);
  }
  if (preset === "last_12_hours") {
    return fields(shiftDuration(current, -12 * 3_600_000), current);
  }
  if (preset === "last_hour") {
    return fields(shiftDuration(current, -3_600_000), current);
  }

  return fields(firstOfMonth(current), current);
}

export function isSalesCashPreset(value: string | undefined): value is SalesCashPreset {
  return (
    value === "custom" ||
    SALES_CASH_PRESETS.some((preset) => preset.value === value)
  );
}
