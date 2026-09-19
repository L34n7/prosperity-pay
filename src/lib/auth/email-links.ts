import { createAdminClient } from "@/lib/supabase/admin";

type LinkType = "invite" | "recovery" | "magiclink";

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function buildConfirmLink(params: {
  appUrl: string;
  tokenHash: string;
  type: LinkType;
  next: "/definir-senha" | "/redefinir-senha";
}) {
  const url = new URL("/auth/confirm", params.appUrl);
  url.searchParams.set("token_hash", params.tokenHash);
  url.searchParams.set("type", params.type);
  url.searchParams.set("next", params.next);
  return url.toString();
}

function isExistingUserError(error: { message?: string } | null) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("already") ||
    message.includes("registered") ||
    message.includes("exists")
  );
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

export async function createFirstAccessLink(params: {
  email: string;
  fullName: string;
  appUrl: string;
}) {
  const email = normalizeEmail(params.email);
  const admin = createAdminClient();

  const invited = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      data: { full_name: params.fullName },
    },
  });

  if (!invited.error) {
    return buildConfirmLink({
      appUrl: params.appUrl,
      tokenHash: tokenHashFrom(invited.data),
      type: "invite",
      next: "/definir-senha",
    });
  }

  if (!isExistingUserError(invited.error)) {
    throw invited.error;
  }

  const recovery = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
  });

  if (!recovery.error) {
    return buildConfirmLink({
      appUrl: params.appUrl,
      tokenHash: tokenHashFrom(recovery.data),
      type: "recovery",
      next: "/definir-senha",
    });
  }

  const magicLink = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  if (magicLink.error) {
    throw recovery.error;
  }

  return buildConfirmLink({
    appUrl: params.appUrl,
    tokenHash: tokenHashFrom(magicLink.data),
    type: "magiclink",
    next: "/definir-senha",
  });
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
      type: "recovery",
      next: "/redefinir-senha",
    }),
    name: profile.data.full_name,
  };
}
