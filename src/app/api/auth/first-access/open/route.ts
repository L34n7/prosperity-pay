import { NextResponse } from "next/server";
import {
  hashFirstAccessToken,
  isValidFirstAccessToken,
} from "@/lib/auth/email-links";
import { createAdminClient } from "@/lib/supabase/admin";

type OpenResult = {
  ok: boolean;
  reason: string;
  email: string | null;
  openings: number;
  max_openings: number;
  remaining_openings: number;
  expires_at: string | null;
};

function invalidResponse(reason: string) {
  switch (reason) {
    case "expired":
      return {
        status: 410,
        error: "Este link de primeiro acesso expirou após 24 horas.",
      };
    case "opening_limit":
      return {
        status: 410,
        error: "Este link já atingiu o limite de 3 aberturas.",
      };
    case "password_set":
      return {
        status: 409,
        error: "A senha deste acesso já foi cadastrada. Use a tela de login.",
      };
    case "invalidated":
      return {
        status: 410,
        error: "Este link foi substituído por um acesso mais recente.",
      };
    default:
      return {
        status: 400,
        error: "Este link de primeiro acesso é inválido.",
      };
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const token = body?.token;

    if (!isValidFirstAccessToken(token)) {
      return NextResponse.json(
        { ok: false, error: "Link de primeiro acesso inválido." },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }

    const admin = createAdminClient();
    const result = await admin.rpc("register_first_access_open", {
      p_token_hash: hashFirstAccessToken(token),
    });

    if (result.error) {
      console.error("[FIRST_ACCESS] Falha ao registrar abertura.", result.error);
      return NextResponse.json(
        { ok: false, error: "Não foi possível validar o link de primeiro acesso." },
        { status: 500, headers: { "Cache-Control": "no-store" } },
      );
    }

    const openResult = (Array.isArray(result.data)
      ? result.data[0]
      : result.data) as OpenResult | null;

    if (!openResult?.ok) {
      const invalid = invalidResponse(openResult?.reason || "invalid");

      return NextResponse.json(
        {
          ok: false,
          error: invalid.error,
          reason: openResult?.reason || "invalid",
        },
        {
          status: invalid.status,
          headers: { "Cache-Control": "no-store" },
        },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        email: openResult.email,
        openings: openResult.openings,
        maxOpenings: openResult.max_openings,
        remainingOpenings: openResult.remaining_openings,
        expiresAt: openResult.expires_at,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[FIRST_ACCESS] Erro inesperado ao validar link.", error);

    return NextResponse.json(
      { ok: false, error: "Não foi possível validar o link de primeiro acesso." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
