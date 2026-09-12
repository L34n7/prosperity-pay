import { NextResponse } from "next/server";
import { asObject, jsonError, optionalString, requiredString } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { digits, sha256 } from "@/lib/security/hash";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase.from("identity_verifications")
      .select("id, person_type, legal_name, tax_id_last4, birth_date, business_name, status, review_note, submitted_at, reviewed_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    return NextResponse.json({ verification: data });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const body = asObject(await request.json());
    const personType = body.personType;
    if (personType !== "individual" && personType !== "business") {
      return NextResponse.json({ error: "Tipo de pessoa invalido." }, { status: 400 });
    }
    const legalName = requiredString(body, "legalName", 180);
    const taxId = digits(requiredString(body, "taxId", 20));
    if (![11, 14].includes(taxId.length)) return NextResponse.json({ error: "CPF/CNPJ invalido." }, { status: 400 });
    const birthDate = optionalString(body, "birthDate", 10);
    if (personType === "individual" && !birthDate) return NextResponse.json({ error: "Data de nascimento obrigatoria." }, { status: 400 });

    const admin = createAdminClient();
    const { data, error } = await admin.from("identity_verifications").insert({
      user_id: user.id,
      person_type: personType,
      legal_name: legalName,
      tax_id_last4: taxId.slice(-4),
      tax_id_hash: sha256(taxId),
      birth_date: birthDate ?? null,
      business_name: optionalString(body, "businessName", 180) ?? null,
    }).select("id, status, submitted_at").single();
    if (error) throw error;
    return NextResponse.json({ verification: data }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
