import { NextRequest, NextResponse } from "next/server";
import {
  SUPPORT_AUTH_COOKIE,
  SUPPORT_MODE_COOKIE,
} from "@/lib/auth/support-mode";
import { ensureInitialPlatformAdmin } from "@/lib/auth/require-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const primary = await createClient({ forcePrimary: true });
  const {
    data: { user: adminUser },
  } = await primary.auth.getUser();

  if (!adminUser || !(await ensureInitialPlatformAdmin(adminUser.id))) {
    return NextResponse.json(
      { error: "Sessão administrativa inválida." },
      { status: 403 },
    );
  }

  const support = await createClient();
  const {
    data: { user: targetUser },
  } = await support.auth.getUser();

  const admin = createAdminClient();
  if (targetUser) {
    await admin
      .from("audit_events")
      .insert({
        actor_user_id: adminUser.id,
        action: "support_mode.ended",
        entity_type: "user",
        entity_id: targetUser.id,
        metadata: { target_email: targetUser.email ?? null },
      })
      .then(() => undefined, () => undefined);
  }

  const response = NextResponse.json({
    ok: true,
    redirectUrl: "/admin/usuarios",
  });

  response.cookies.set(SUPPORT_MODE_COOKIE, "", {
    path: "/",
    maxAge: 0,
  });

  request.cookies
    .getAll()
    .filter(({ name }) => name.startsWith(SUPPORT_AUTH_COOKIE))
    .forEach(({ name }) => {
      response.cookies.set(name, "", { path: "/", maxAge: 0 });
    });

  return response;
}
