import { NextResponse } from "next/server";
import { asObject, jsonError, requiredInteger, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { notifyFinanceAdmins } from "@/lib/email/financial-review";
import { pixKeyTypeLabel } from "@/lib/financial/pix-labels";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("withdrawals").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ withdrawals: data });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = asObject(await request.json());
    const amountCents = requiredInteger(body, "amountCents", 500);
    const payoutAccountId = requiredString(body, "payoutAccountId", 36);

    const { data: balance, error: balanceError } = await supabase
      .from("user_balance_summary")
      .select("available_cents")
      .eq("user_id", user.id)
      .maybeSingle();

    if (balanceError) throw balanceError;

    const availableCents = balance?.available_cents ?? 0;
    if (amountCents > availableCents) {
      return NextResponse.json(
        { error: "O valor solicitado é maior que o saldo disponível." },
        { status: 400 },
      );
    }

    const { data, error } = await supabase.rpc("request_withdrawal", {
      requested_amount_cents: amountCents,
      requested_payout_account_id: payoutAccountId,
    });
    if (error) throw error;

    const { data: payoutAccount } = await supabase
      .from("payout_accounts")
      .select("key_type,key_last4,holder_name")
      .eq("id", payoutAccountId)
      .eq("user_id", user.id)
      .maybeSingle();

    await notifyFinanceAdmins({
      requesterUserId: user.id,
      kind: "withdrawal",
      details: [
        {
          label: "Valor",
          value: new Intl.NumberFormat("pt-BR", {
            style: "currency",
            currency: "BRL",
          }).format(amountCents / 100),
        },
        {
          label: "Chave Pix",
          value: payoutAccount
            ? `${pixKeyTypeLabel(payoutAccount.key_type)} · ••••${payoutAccount.key_last4}`
            : "Chave selecionada",
        },
        {
          label: "Titular",
          value: payoutAccount?.holder_name || "Não informado",
        },
      ],
    });

    return NextResponse.json({ withdrawal: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
