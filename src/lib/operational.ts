export function formatCents(value: number | string | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0) / 100);
}
export function formatDate(value: string | null | undefined) { return value ? new Date(value).toLocaleDateString("pt-BR") : "—"; }
export async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers }, cache: "no-store" });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Não foi possível concluir a operação.");
  return json as T;
}
