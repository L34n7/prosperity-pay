import { NextResponse } from "next/server";
import { asObject, requiredString } from "@/lib/api/http";
import { createPasswordRecoveryLink } from "@/lib/auth/email-links";
import { sendPasswordRecoveryEmail } from "@/lib/email/resend-auth";
import { env } from "@/lib/env";

export async function POST(request: Request) {
  try {
    const body = asObject(await request.json());
    const email = requiredString(body, "email", 320).toLowerCase();
    const appUrl = (env.appUrl ?? new URL(request.url).origin).replace(/\/$/, "");

    const recovery = await createPasswordRecoveryLink({ email, appUrl });

    if (!recovery) {
      return NextResponse.json({ sent: true });
    }

    await sendPasswordRecoveryEmail({
      to: email,
      name: recovery.name || "cliente",
      link: recovery.link,
    });

    return NextResponse.json({ sent: true });
  } catch (error) {
    console.error("[AUTH_RECOVERY] Falha ao processar recuperação.", error);
    return NextResponse.json(
      {
        error:
          "Não foi possível enviar o e-mail de recuperação agora. Tente novamente em alguns minutos.",
      },
      { status: 502 },
    );
  }
}
