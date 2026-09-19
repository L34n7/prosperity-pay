export type ProductPaymentType = "one_time" | "recurring";
export type ProductKind = "digital" | "physical";
export type RecurrenceFrequency = "weekly" | "monthly" | "quarterly" | "semiannual" | "annual";

export const PRODUCT_CATEGORIES = [
  "Software e SaaS",
  "Cursos e Educação",
  "Serviços",
  "Consultoria",
  "Marketing e Vendas",
  "Saúde e Bem-estar",
  "Beleza e Estética",
  "Pet",
  "Moda e Acessórios",
  "Casa e Decoração",
  "Alimentação",
  "Eventos",
  "Finanças",
  "Imobiliário",
  "Tecnologia e Eletrônicos",
  "Outros",
] as const;

export function isProductCategory(value: unknown): value is typeof PRODUCT_CATEGORIES[number] {
  return typeof value === "string" && PRODUCT_CATEGORIES.includes(value as typeof PRODUCT_CATEGORIES[number]);
}

export const RECURRENCE_OPTIONS: { value: RecurrenceFrequency; label: string }[] = [
  { value: "weekly", label: "Semanal" },
  { value: "monthly", label: "Mensal" },
  { value: "quarterly", label: "Trimestral" },
  { value: "semiannual", label: "Semestral" },
  { value: "annual", label: "Anual" },
];

export function isProductPaymentType(value: unknown): value is ProductPaymentType {
  return value === "one_time" || value === "recurring";
}
export function isProductKind(value: unknown): value is ProductKind {
  return value === "digital" || value === "physical";
}
export function isRecurrenceFrequency(value: unknown): value is RecurrenceFrequency {
  return RECURRENCE_OPTIONS.some((option) => option.value === value);
}
export function recurrenceToBilling(frequency: RecurrenceFrequency) {
  switch (frequency) {
    case "weekly": return { interval: "week", count: 1 } as const;
    case "monthly": return { interval: "month", count: 1 } as const;
    case "quarterly": return { interval: "month", count: 3 } as const;
    case "semiannual": return { interval: "month", count: 6 } as const;
    case "annual": return { interval: "year", count: 1 } as const;
  }
}
export function centsFromMoney(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}
