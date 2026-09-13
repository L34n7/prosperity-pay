import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const next = request.nextUrl.searchParams.get("next");
  const destination = next === "/redefinir-senha" ? next : "/dashboard";
  const supabase = await createClient();
  const result = code ? await supabase.auth.exchangeCodeForSession(code) : tokenHash && (type === "recovery" || type === "signup" || type === "email") ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type }) : { error: new Error("Link inválido") };
  return NextResponse.redirect(new URL(result.error ? "/login?erro=confirmacao" : destination, request.url));
}
