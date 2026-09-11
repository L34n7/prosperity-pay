import { moneyFormatter } from "@/lib/dashboard/formatters";

export function Money({ value }: { value: number }) {
  return <>{moneyFormatter.format(value)}</>;
}
