import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import {
  createFirstAccessLink,
  discardFirstAccessToken,
  invalidatePreviousFirstAccessTokens,
} from "@/lib/auth/email-links";
import { sendFirstAccessEmail } from "@/lib/email/resend-auth";
import { env } from "@/lib/env";

export async function POST(request: Request) {
  try {
    const body = asObject(await request.json());
    const fullName = requiredString(body, "fullName", 160);
    const email = requiredString(body, "email", 320).toLowerCase();
    const appUrl = (env.appUrl ?? new URL(request.url).origin).replace(/\/$/, "");

    const firstAccess = await createFirstAccessLink({
      email,
      fullName,
      appUrl,
    });

    try {
      await sendFirstAccessEmail({
        to: email,
        name: fullName,
        link: firstAccess.link,
      });
    } catch (error) {
      await discardFirstAccessToken(firstAccess.tokenId);
      throw error;
    }

    await invalidatePreviousFirstAccessTokens({
      authUserId: firstAccess.authUserId,
      keepTokenId: firstAccess.tokenId,
    });

    return NextResponse.json(
      {
        sent: true,
        expiresAt: firstAccess.expiresAt,
        maxOpenings: firstAccess.maxOpenings,
      },
      { status: 201 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
