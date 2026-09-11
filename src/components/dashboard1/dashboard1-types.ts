import type { LucideIcon } from "lucide-react";

export type ConceptModule = "overview" | "payments" | "subscriptions" | "affiliates" | "commissions";

export type ConceptMetric = {
  label: string;
  value: string;
  detail: string;
  trend?: string;
  icon: LucideIcon;
  tone?: "emerald" | "gold" | "neutral";
};
