import { NextResponse } from "next/server";
import { asObject, jsonError, optionalString, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { toSlug } from "@/lib/domain/slug";

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase.from("products").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return NextResponse.json({ products: data });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const body = asObject(await request.json());
    const name = requiredString(body, "name", 180);
    const description = optionalString(body, "description", 4000);
    const settlementModel = body.settlementModel;
    if (settlementModel !== "connected_account" && settlementModel !== "prosperity_balance") {
      return NextResponse.json({ error: "Modelo de recebimento invalido." }, { status: 400 });
    }
    const slug = `${toSlug(name)}-${crypto.randomUUID().slice(0, 8)}`;
    const { data, error } = await supabase.from("products").insert({
      producer_id: user.id, name, description, slug, settlement_model: settlementModel,
    }).select().single();
    if (error) throw error;
    return NextResponse.json({ product: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
