import { NextResponse } from "next/server";
import { resendAutomaticDueBilling } from "@/lib/subscriptions/automatic-due-billing";

const sundayUnpaidSubscriptionIds = [
  "439ab0c5-6459-46e9-8d04-a9bc1c2f57f9",
  "4ab68dce-3294-48c3-a3df-ea6b00be3ccc",
  "c68e5bf7-aad2-4c04-9eb7-25b165a7fcca",
  "8f1d76f6-8ba0-4d4f-8499-14118777eab8",
  "01067952-aeeb-4ebf-b752-09e790df1a18",
  "5271639a-dbd0-4fb0-9d45-c92b10089794",
  "dfe67cd2-42b8-4c9b-a164-4611253a9a14",
];

export async function GET() {
  const result = await resendAutomaticDueBilling(sundayUnpaidSubscriptionIds);
  return NextResponse.json({ ok: true, ...result });
}
