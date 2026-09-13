"use client";
import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Brand } from "@/components/ui/brand";

type Mode = "login" | "cadastro" | "esqueci-senha" | "redefinir-senha";
const headings: Record<Mode, string> = { login: "Entre na sua conta", cadastro: "Crie sua conta", "esqueci-senha": "Recuperar senha", "redefinir-senha": "Defina uma nova senha" };
const AUTH_TIMEOUT_MS = 20_000;

async function withAuthTimeout<T>(request: PromiseLike<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("A conexão demorou demais. Confira seu e-mail antes de tentar novamente; se a conta já foi criada, entre pelo login.")), AUTH_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setSuccess("");
    const values = new FormData(event.currentTarget);
    const email = String(values.get("email") ?? "").trim();
    const password = String(values.get("password") ?? "");
    try {
      if (mode === "cadastro") {
        const response = await fetch("/api/auth/signup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, fullName: String(values.get("name") ?? "").trim() }),
          signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Não foi possível criar a conta.");
        if (result.session) { router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"); router.refresh(); }
        else setSuccess("Verifique seu e-mail para confirmar a conta.");
      } else if (mode === "login") {
        const supabase = createClient();
        const { error } = await withAuthTimeout(supabase.auth.signInWithPassword({ email, password }));
        if (error) throw error;
        router.replace(next?.startsWith("/") && !next.startsWith("//") ? next : "/dashboard"); router.refresh();
      } else if (mode === "esqueci-senha") {
        const supabase = createClient();
        const { error } = await withAuthTimeout(supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/confirm?next=/redefinir-senha` }));
        if (error) throw error;
        setSuccess("Se este e-mail estiver cadastrado, você receberá um link para redefinir a senha.");
      } else {
        if (password !== values.get("confirm")) throw new Error("As senhas não coincidem.");
        const supabase = createClient();
        const { error } = await withAuthTimeout(supabase.auth.updateUser({ password }));
        if (error) throw error;
        router.replace("/dashboard"); router.refresh();
      }
    } catch (cause) { setError(cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError") ? "A conexão demorou demais. Confira seu e-mail antes de tentar novamente; se a conta já foi criada, entre pelo login." : cause instanceof Error ? cause.message : "Não foi possível concluir. Tente novamente."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-card"><Brand href="/"/><h1>{headings[mode]}</h1>
    <form onSubmit={submit} className="operational-form">
      {mode === "cadastro" && <label>Nome completo<input name="name" minLength={2} required autoComplete="name"/></label>}
      {mode !== "redefinir-senha" && <label>E-mail<input name="email" type="email" required autoComplete="email"/></label>}
      {mode !== "esqueci-senha" && <label>Senha<input name="password" type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"}/></label>}
      {mode === "redefinir-senha" && <label>Confirme a senha<input name="confirm" type="password" required minLength={8} autoComplete="new-password"/></label>}
      {error && <p className="form-error" role="alert">{error}</p>}{success && <p className="form-success" role="status">{success}</p>}
      <button className="primary-button" disabled={busy}>{busy ? "Aguarde..." : mode === "login" ? "Entrar" : mode === "cadastro" ? "Criar conta" : mode === "esqueci-senha" ? "Enviar link" : "Salvar senha"}</button>
    </form><div className="auth-links">{mode !== "login" && <Link href="/login">Voltar ao login</Link>}{mode === "login" && <><Link href="/esqueci-senha">Esqueci minha senha</Link><Link href="/cadastro">Criar conta</Link></>}</div>
  </div></main>;
}
