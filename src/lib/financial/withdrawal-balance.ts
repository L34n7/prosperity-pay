export const MIN_WITHDRAWAL_CENTS = 500;

export function withdrawableBalanceCents(value: number | null | undefined) {
  const available = Math.max(0, Number(value ?? 0));
  return available >= MIN_WITHDRAWAL_CENTS ? available : 0;
}

export function residualBalanceCents(value: number | null | undefined) {
  const available = Math.max(0, Number(value ?? 0));
  return available - withdrawableBalanceCents(available);
}
