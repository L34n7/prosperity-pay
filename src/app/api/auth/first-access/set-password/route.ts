import { NextResponse } from "next/server";
import {
  hashFirstAccessToken,
  isValidFirstAccessToken,
} from "@/lib/auth/email-links";
import { createAdminClient } from "@/lib/supabase/admin";

type Reservation = {
  ok: boolean;
  reason: string;
  auth_user_id: string | null;
  email: string | null;
};

function passwordIsValid(password: string) {
  const requirements = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];

  return requirements.filter(Boolean).length >= 4;
}

function invalidReservation(reason: string) {
  switch (reason) {
    case "expired":
      return {
        status: 410,
        error: "Este link de primeiro acesso expirou após 24 horas.",
      };
    case "password_set":
      return {
        status: 409,
        error: "A senha deste acesso já foi cadastrada.",
      };
    case "invalidated":
      return {
        status: 410,
        error: "Este link foi substituído por um acesso mais recente.",
      };
    case "open_required":
      return {
        status: 400,
        error: "Abra o link de primeiro acesso antes de cadastrar a senha.",
      };
    case "processing":
      return {
        status: 409,
        error: "A criação da senha já está sendo processada em outra aba.",
      };
    default:
      return {
        status: 400,
        error: "Link de primeiro acesso inválido.",
      };
  }
}

async function completeToken(tokenHash: string) {
  const admin = createAdminClient();
  const completed = await admin.rpc("complete_first_access_password", {
    p_token_hash: tokenHash,
  });

  if (!completed.error && completed.data === true) {
    return;
  }

  const fallback = await admin
    .from("first_access_tokens")
    .update({
      password_set_at: new Date().toISOString(),
      processing_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("token_hash", tokenHash)
    .is("password_set_at", null);

  if (fallback.error) {
    console.error("[FIRST_ACCESS] Senha criada, mas token não foi encerrado.", {
      rpcError: completed.error?.message,
      fallbackError: fallback.error.message,
    });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = body?.token;
  const password = typeof body?.password === "string" ? body.password : "";

  if (!isValidFirstAccessToken(token)) {
    return NextResponse.json(
      { ok: false, error: "Link de primeiro acesso inválido." },
      { status: 400 },
    );
  }

  if (!passwordIsValid(password)) {
    return NextResponse.json(
      {
        ok: false,
        error: "A senha não atende aos requisitos de segurança.",
      },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const tokenHash = hashFirstAccessToken(token);
  const reservationResult = await admin.rpc("reserve_first_access_password", {
    p_token_hash: tokenHash,
  });

  if (reservationResult.error) {
    console.error(
      "[FIRST_ACCESS] Falha ao reservar definição de senha.",
      reservationResult.error,
    );

    return NextResponse.json(
      { ok: false, error: "Não foi possível validar este primeiro acesso." },
      { status: 500 },
    );
  }

  const reservation = (Array.isArray(reservationResult.data)
    ? reservationResult.data[0]
    : reservationResult.data) as Reservation | null;

  if (!reservation?.ok || !reservation.auth_user_id) {
    const invalid = invalidReservation(reservation?.reason || "invalid");

    return NextResponse.json(
      {
        ok: false,
        error: invalid.error,
        reason: reservation?.reason || "invalid",
      },
      { status: invalid.status },
    );
  }

  try {
    const current = await admin.auth.admin.getUserById(
      reservation.auth_user_id,
    );

    if (current.error || !current.data.user) {
      throw current.error ?? new Error("Usuário de autenticação não encontrado.");
    }

    const user = current.data.user;
    const alreadySet = Boolean(
      user.app_metadata?.first_access_password_set_at,
    );

    if (alreadySet) {
      await completeToken(tokenHash);

      return NextResponse.json(
        {
          ok: false,
          error: "A senha deste acesso já foi cadastrada.",
          reason: "password_set",
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const updated = await admin.auth.admin.updateUserById(
      reservation.auth_user_id,
      {
        password,
        email_confirm: true,
        app_metadata: {
          ...(user.app_metadata ?? {}),
          first_access_password_set_at: now,
        },
      },
    );

    if (updated.error) {
      throw updated.error;
    }

    await completeToken(tokenHash);

    return NextResponse.json({
      ok: true,
      email: reservation.email,
      message: "Senha criada com sucesso.",
    });
  } catch (error) {
    await admin.rpc("release_first_access_password", {
      p_token_hash: tokenHash,
    });

    console.error("[FIRST_ACCESS] Falha ao definir senha.", error);

    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Erro inesperado ao definir a senha.",
      },
      { status: 500 },
    );
  }
}
