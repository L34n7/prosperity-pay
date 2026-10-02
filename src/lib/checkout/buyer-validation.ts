export function isValidBuyerEmail(value: string) {
  const email = value.trim();
  if (email.length > 254) return false;
  const [local, domain] = email.split("@");
  if (!local || !domain || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (domain.split(".").some((label) => label.length > 63)) return false;
  return /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email);
}

export function isValidBuyerCpf(value: string) {
  const cpf = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let length = 9; length <= 10; length++) {
    let sum = 0;
    for (let index = 0; index < length; index++) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    if (Number(cpf[length]) !== (remainder === 10 ? 0 : remainder)) return false;
  }
  return true;
}

export function buyerValidationError(email: string, cpf?: string) {
  if (!isValidBuyerEmail(email)) return "Informe um e-mail válido, como nome@exemplo.com.br.";
  if (cpf !== undefined && !isValidBuyerCpf(cpf)) return "CPF inválido. Confira os 11 dígitos do CPF do pagador.";
  return "";
}
