import { NextResponse } from "next/server";
import { reconcileMercadoPagoFees } from "@/lib/payments/mercado-pago-fee-reconciliation";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  const admin = createAdminClient();

  const { data: payments, error } = await admin
    .from("payments")
    .select(
      "id,order_id,connection_id,status,external_payment_id,provider_fee_amount_cents,raw_provider_data",
    )
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) throw error;

  const rows = (payments ?? []).map((payment) => ({
    id: payment.id,
    order_id: payment.order_id,
    connection_id: payment.connection_id,
    status: payment.status,
    external_payment_id: payment.external_payment_id,
    provider_fee_amount_cents: Number(payment.provider_fee_amount_cents ?? 0),
    raw_provider_data: payment.raw_provider_data,
  }));

  const reconciled = await reconcileMercadoPagoFees({
    admin,
    payments: rows,
    limit: 500,
    force: true,
  });

  return NextResponse.json({
    scanned: rows.length,
    reconciled: reconciled.size,
    fees: [...reconciled.entries()].map(([paymentId, feeCents]) => ({
      paymentId,
      feeCents,
    })),
  });
}
