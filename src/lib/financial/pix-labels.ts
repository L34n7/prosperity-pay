export function pixKeyTypeLabel(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "cpf") return "CPF";
  if (normalized === "cnpj") return "CNPJ";
  if (normalized === "email") return "E-mail";
  if (normalized === "phone") return "Telefone";
  if (normalized === "random_key" || normalized === "random") return "Chave aleatória";

  return value ? String(value) : "Chave Pix";
}
