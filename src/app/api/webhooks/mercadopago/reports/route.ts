import { NextResponse } from "next/server";

export async function POST() {
  // O notificador é obrigatório para a configuração de relatórios do Mercado Pago.
  // A conciliação é feita de forma idempotente pelo cron/página de pagamentos;
  // este endpoint apenas confirma o recebimento da notificação de disponibilidade.
  return NextResponse.json({ received: true });
}
