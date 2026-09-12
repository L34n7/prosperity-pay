import { NextResponse } from "next/server";
import { asObject, jsonError, requiredString } from "@/lib/api/http";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = asObject(await request.json());
    const fullName = requiredString(body, "fullName", 160);
    const email = requiredString(body, "email", 320).toLowerCase();
    const password = requiredString(body, "password", 128);
    if (password.length < 8) return NextResponse.json({ error: "A senha precisa ter ao menos 8 caracteres." }, { status: 400 });

    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    if (error) throw error;
    return NextResponse.json({ user: data.user, session: Boolean(data.session) }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
