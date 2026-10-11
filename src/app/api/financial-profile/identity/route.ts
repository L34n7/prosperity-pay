import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { onlyDigits, isValidTaxId, validateAdultBirthDate } from "@/lib/validation/br-documents";
import { sha256 } from "@/lib/security/hash";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

function formString(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function extensionFor(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "application/pdf") return "pdf";
  return "bin";
}

export async function GET() {
  try {
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("identity_verifications")
      .select(
        "id, person_type, legal_name, tax_id_last4, birth_date, business_name, status, review_note, submitted_at, reviewed_at, document_original_name, document_uploaded_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json({ verification: data });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  let uploadedPath: string | null = null;

  try {
    const { user } = await requireUser();
    const form = await request.formData();
    const personType = formString(form, "personType");

    if (personType !== "individual" && personType !== "business") {
      return NextResponse.json({ error: "Tipo de pessoa inválido." }, { status: 400 });
    }

    const legalName = formString(form, "legalName");
    if (!legalName || legalName.length > 180) {
      return NextResponse.json({ error: "Informe o nome legal." }, { status: 400 });
    }

    const taxIdRaw = formString(form, "taxId");
    const taxId = onlyDigits(taxIdRaw);
    const expectedLength = personType === "individual" ? 11 : 14;
    if (taxId.length !== expectedLength || !isValidTaxId(taxId, personType)) {
      return NextResponse.json(
        { error: personType === "individual" ? "CPF inválido." : "CNPJ inválido." },
        { status: 400 },
      );
    }

    const businessName = formString(form, "businessName");
    if (personType === "business" && !businessName) {
      return NextResponse.json({ error: "Informe a razão social." }, { status: 400 });
    }
    if (businessName.length > 180) {
      return NextResponse.json({ error: "Razão social muito longa." }, { status: 400 });
    }

    const birthDate = formString(form, "birthDate");
    if (personType === "individual") {
      if (!birthDate) {
        return NextResponse.json(
          { error: "Data de nascimento obrigatória." },
          { status: 400 },
        );
      }
      const validation = validateAdultBirthDate(birthDate);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    }

    const document = form.get("document");
    if (!(document instanceof File) || document.size <= 0) {
      return NextResponse.json(
        { error: "Envie uma foto ou PDF do documento com foto." },
        { status: 400 },
      );
    }
    if (document.size > MAX_DOCUMENT_BYTES) {
      return NextResponse.json(
        { error: "O documento deve ter no máximo 5 MB." },
        { status: 400 },
      );
    }
    if (!ALLOWED_DOCUMENT_TYPES.has(document.type)) {
      return NextResponse.json(
        { error: "Formato não permitido. Use JPG, PNG, WEBP ou PDF." },
        { status: 400 },
      );
    }

    const admin = createAdminClient();

    const { data: latest, error: latestError } = await admin
      .from("identity_verifications")
      .select("id,status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) throw latestError;
    if (latest && ["under_review", "approved"].includes(latest.status)) {
      return NextResponse.json(
        {
          error:
            latest.status === "approved"
              ? "Sua identidade já foi aprovada."
              : "Já existe uma verificação em análise.",
        },
        { status: 409 },
      );
    }

    const extension = extensionFor(document.type);
    uploadedPath = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const bytes = new Uint8Array(await document.arrayBuffer());
    const { error: uploadError } = await admin.storage
      .from("identity-documents")
      .upload(uploadedPath, bytes, {
        contentType: document.type,
        cacheControl: "3600",
        upsert: false,
      });
    if (uploadError) throw uploadError;

    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("identity_verifications")
      .insert({
        user_id: user.id,
        person_type: personType,
        legal_name: legalName,
        tax_id_last4: taxId.slice(-4),
        tax_id_hash: sha256(taxId),
        birth_date: personType === "individual" ? birthDate : null,
        business_name: personType === "business" ? businessName : null,
        document_storage_path: uploadedPath,
        document_original_name: document.name.slice(0, 255),
        document_mime_type: document.type,
        document_uploaded_at: now,
      })
      .select("id, status, submitted_at")
      .single();

    if (error) {
      await admin.storage.from("identity-documents").remove([uploadedPath]);
      uploadedPath = null;
      throw error;
    }

    return NextResponse.json({ verification: data }, { status: 201 });
  } catch (error) {
    if (uploadedPath) {
      try {
        const admin = createAdminClient();
        await admin.storage.from("identity-documents").remove([uploadedPath]);
      } catch {
        // Best effort cleanup.
      }
    }
    return jsonError(error);
  }
}
