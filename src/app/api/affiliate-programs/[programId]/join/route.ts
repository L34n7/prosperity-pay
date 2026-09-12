import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api/http";
import { requireUser } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";

type Context = { params: Promise<{ programId: string }> };

export async function POST(_: Request, context: Context) {
  try {
    const { programId } = await context.params;
    const { user } = await requireUser();
    const admin = createAdminClient();
    const { data: program, error: programError } = await admin.from("affiliate_programs")
      .select("mode, active, products(producer_id)").eq("id", programId).single();
    if (programError || !program?.active) return NextResponse.json({ error: "Programa indisponivel." }, { status: 404 });
    if (program.products && !Array.isArray(program.products) && program.products.producer_id === user.id) {
      return NextResponse.json({ error: "O produtor nao pode se afiliar ao proprio produto." }, { status: 409 });
    }
    if (program.mode === "invite") return NextResponse.json({ error: "Este programa aceita apenas convidados." }, { status: 403 });
    const code = `${(user.email?.split("@")[0] ?? "AFILIADO").replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 12)}${randomBytes(3).toString("hex").toUpperCase()}`;
    const { data, error } = await admin.from("affiliate_memberships").insert({
      program_id: programId, user_id: user.id, code,
      status: program.mode === "public" ? "active" : "pending",
      approved_at: program.mode === "public" ? new Date().toISOString() : null,
    }).select().single();
    if (error) throw error;
    let link = null;
    if (data.status === "active") {
      const created = await admin.from("affiliate_links").insert({
        membership_id: data.id, ref_code: data.code,
      }).select().single();
      if (created.error) throw created.error;
      link = created.data;
    }
    return NextResponse.json({ membership: data, link }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
