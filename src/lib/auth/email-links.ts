import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const FIRST_ACCESS_DURATION_MS = 24 * 60 * 60 * 1000;
const FIRST_ACCESS_MAX_OPENINGS = 3;

type AuthLinkType = "invite" | "recovery" | "magiclink";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function buildAuthConfirmLink(params: {
  appUrl: string;
  tokenHash: string;
  type: AuthLinkType | "email" | "signup";
  next: "/definir-senha" | "/redefinir-senha";
}) {
  const url = new URL("/auth/confirm", params.appUrl);
  url.searchParams.set("token_hash", params.tokenHash);
  url.searchParams.set("type", params.type);
  url.searchParams.set("next", params.next);
  return url.toString();
}

function tokenHashFrom(data: {
  properties?: { hashed_token?: string | null } | null;
}) {
  const tokenHash = data.properties?.hashed_token;

  if (!tokenHash) {
    throw new Error("O provedor de autenticação não retornou um token seguro.");
  }

  return tokenHash;
}

function isExistingUserError(error: { message?: string } | null) {
  const message = String(error?.message || "").toLowerCase();

  return (
    message.includes("already") ||
    message.includes("registered") ||
    message.includes("exists")
  );
}

function isFirstAccessSchemaMissing(error: {
  code?: string;
  message?: string;
} | null) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();

  return (
    code === "PGRST202" ||
    code === "42883" ||
    code === "42P01" ||
    message.includes("get_auth_user_id_by_email") ||
    message.includes("first_access_tokens")
  );
}

export function hashFirstAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isValidFirstAccessToken(token: unknown): token is string {
  return (
    typeof token === "string" &&
    token.length >= 32 &&
    token.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(token)
  );
}

async function getAuthUserIdByEmail(email: string) {
  const admin = createAdminClient();
  const result = await admin.rpc("get_auth_user_id_by_email", {
    p_email: email,
  });

  if (result.error) {
    throw result.error;
  }

  return typeof result.data === "string" && result.data ? result.data : null;
}

async function ensureAuthUser(params: {
  email: string;
  fullName: string;
}) {
  const admin = createAdminClient();
  const email = normalizeEmail(params.email);
  let userId = await getAuthUserIdByEmail(email);

  if (!userId) {
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { full_name: params.fullName },
    });

    if (created.error || !created.data.user) {
      throw created.error ?? new Error("Não foi possível criar o usuário.");
    }

    return created.data.user.id;
  }

  const current = await admin.auth.admin.getUserById(userId);

  if (current.error || !current.data.user) {
    throw current.error ?? new Error("Usuário de autenticação não encontrado.");
  }

  const updated = await admin.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...(current.data.user.user_metadata ?? {}),
      full_name: params.fullName,
    },
  });

  if (updated.error) {
    throw updated.error;
  }

  return userId;
}

async function createLegacyFirstAccessLink(params: {
  email: string;
  fullName: string;
  appUrl: string;
}) {
  const admin = createAdminClient();
  const email = normalizeEmail(params.email);

  let generated = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { full_name: params.fullName },
    },
  });

  let type: AuthLinkType = "invite";

  if (generated.error && isExistingUserError(generated.error)) {
    generated = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
    });
    type = "recovery";
  }

  if (generated.error) {
    generated = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    type = "magiclink";
  }

  if (generated.error) {
    throw generated.error;
  }

  return {
    mode: "legacy" as const,
    link: buildAuthConfirmLink({
      appUrl: params.appUrl,
      tokenHash: tokenHashFrom(generated.data),
      type,
      next: "/definir-senha",
    }),
  };
}

export async function createFirstAccessLink(params: {
  email: string;
  fullName: string;
  appUrl: string;
}) {
  const admin = createAdminClient();
  const email = normalizeEmail(params.email);

  let authUserId: string;

  try {
    authUserId = await ensureAuthUser({
      email,
      fullName: params.fullName,
    });
  } catch (error) {
    if (
      isFirstAccessSchemaMissing(
        error && typeof error === "object"
          ? (error as { code?: string; message?: string })
          : null,
      )
    ) {
      console.warn(
        "[FIRST_ACCESS] Estrutura protegida ainda não aplicada; usando fluxo legado temporariamente.",
      );

      return createLegacyFirstAccessLink(params);
    }

    throw error;
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashFirstAccessToken(token);
  const expiresAt = new Date(Date.now() + FIRST_ACCESS_DURATION_MS).toISOString();

  const inserted = await admin
    .from("first_access_tokens")
    .insert({
      auth_user_id: authUserId,
      email,
      token_hash: tokenHash,
      expires_at: expiresAt,
      openings: 0,
      max_openings: FIRST_ACCESS_MAX_OPENINGS,
    })
    .select("id")
    .single();

  if (inserted.error || !inserted.data) {
    if (isFirstAccessSchemaMissing(inserted.error)) {
      console.warn(
        "[FIRST_ACCESS] Tabela protegida ainda não aplicada; usando fluxo legado temporariamente.",
      );

      return createLegacyFirstAccessLink(params);
    }

    throw inserted.error ?? new Error("Não foi possível criar o primeiro acesso.");
  }

  const link = new URL("/primeiro-acesso", params.appUrl);
  link.searchParams.set("token", token);

  return {
    mode: "protected" as const,
    link: link.toString(),
    tokenId: inserted.data.id,
    authUserId,
    expiresAt,
    maxOpenings: FIRST_ACCESS_MAX_OPENINGS,
  };
}

export async function discardFirstAccessToken(tokenId: string) {
  const admin = createAdminClient();
  const removed = await admin
    .from("first_access_tokens")
    .delete()
    .eq("id", tokenId);

  if (removed.error) {
    console.error("[FIRST_ACCESS] Falha ao remover token não enviado.", {
      tokenId,
      error: removed.error.message,
    });
  }
}

export async function invalidatePreviousFirstAccessTokens(params: {
  authUserId: string;
  keepTokenId: string;
}) {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  const result = await admin
    .from("first_access_tokens")
    .update({
      invalidated_at: now,
      updated_at: now,
    })
    .eq("auth_user_id", params.authUserId)
    .neq("id", params.keepTokenId)
    .is("password_set_at", null)
    .is("invalidated_at", null);

  if (result.error) {
    console.error("[FIRST_ACCESS] Falha ao invalidar links anteriores.", {
      authUserId: params.authUserId,
      error: result.error.message,
    });
  }
}

export async function createPasswordRecoveryLink(params: {
  email: string;
  appUrl: string;
}) {
  const email = normalizeEmail(params.email);
  const admin = createAdminClient();

  const profile = await admin
    .from("profiles")
    .select("full_name")
    .eq("email", email)
    .maybeSingle();

  if (profile.error) {
    throw profile.error;
  }

  if (!profile.data) {
    return null;
  }

  const recovery = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  if (recovery.error) {
    return null;
  }

  return {
    link: buildAuthConfirmLink({
      appUrl: params.appUrl,
      tokenHash: tokenHashFrom(recovery.data),
      type: "recovery",
      next: "/redefinir-senha",
    }),
    name: profile.data.full_name,
  };
}
