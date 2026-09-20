import { createHash, randomBytes } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const FIRST_ACCESS_DURATION_MS = 24 * 60 * 60 * 1000;
const FIRST_ACCESS_MAX_OPENINGS = 3;

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function buildConfirmLink(params: {
  appUrl: string;
  tokenHash: string;
  next: "/redefinir-senha";
}) {
  const url = new URL("/auth/confirm", params.appUrl);
  url.searchParams.set("token_hash", params.tokenHash);
  url.searchParams.set("type", "recovery");
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

export async function createFirstAccessLink(params: {
  email: string;
  fullName: string;
  appUrl: string;
}) {
  const admin = createAdminClient();
  const email = normalizeEmail(params.email);
  const authUserId = await ensureAuthUser({
    email,
    fullName: params.fullName,
  });

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
    throw inserted.error ?? new Error("Não foi possível criar o primeiro acesso.");
  }

  const link = new URL("/primeiro-acesso", params.appUrl);
  link.searchParams.set("token", token);

  return {
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
    link: buildConfirmLink({
      appUrl: params.appUrl,
      tokenHash: tokenHashFrom(recovery.data),
      next: "/redefinir-senha",
    }),
    name: profile.data.full_name,
  };
}
