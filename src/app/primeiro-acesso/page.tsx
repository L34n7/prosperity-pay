"use client";

import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Brand } from "@/components/ui/brand";
import styles from "./page.module.css";

export default function FirstAccessPage() {
  const router = useRouter();
  const openingRegistered = useRef(false);

  const [token, setToken] = useState("");
  const [validating, setValidating] = useState(true);
  const [validLink, setValidLink] = useState(false);
  const [email, setEmail] = useState("");
  const [remainingOpenings, setRemainingOpenings] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [errorReason, setErrorReason] = useState("");
  const [success, setSuccess] = useState("");

  const requirements = useMemo(
    () => ({
      minimum: password.length >= 8,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /\d/.test(password),
      special: /[^A-Za-z0-9]/.test(password),
    }),
    [password],
  );

  const requirementsMet = Object.values(requirements).filter(Boolean).length;
  const passwordsMatch = password.length > 0 && password === confirmation;
  const validPassword = requirementsMet >= 4 && passwordsMatch;

  useEffect(() => {
    if (openingRegistered.current) return;
    openingRegistered.current = true;

    async function validateLink() {
      const urlToken = new URLSearchParams(window.location.search)
        .get("token")
        ?.trim();

      if (!urlToken) {
        setError("Link de primeiro acesso inválido.");
        setErrorReason("invalid");
        setValidating(false);
        return;
      }

      setToken(urlToken);

      try {
        const response = await fetch("/api/auth/first-access/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: urlToken }),
          cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok || !result.ok) {
          setError(result.error || "Não foi possível validar este link.");
          setErrorReason(result.reason || "invalid");
          return;
        }

        setErrorReason("");
        setValidLink(true);
        setEmail(result.email || "");
        setRemainingOpenings(
          typeof result.remainingOpenings === "number"
            ? result.remainingOpenings
            : null,
        );
        setExpiresAt(result.expiresAt || null);
      } catch {
        setError("Não foi possível validar este link de primeiro acesso.");
        setErrorReason("validation_error");
      } finally {
        setValidating(false);
      }
    }

    void validateLink();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!validLink || !token) {
      setError("Este link não está disponível para cadastrar a senha.");
      return;
    }

    if (!validPassword) {
      setError("Crie uma senha segura e confirme corretamente.");
      return;
    }

    try {
      setSubmitting(true);

      const response = await fetch("/api/auth/first-access/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const result = await response.json();

      if (!response.ok || !result.ok) {
        setError(result.error || "Não foi possível cadastrar sua senha.");

        if (
          result.reason === "password_set" ||
          result.reason === "expired" ||
          result.reason === "invalidated"
        ) {
          setErrorReason(result.reason);
          setValidLink(false);
        }

        return;
      }

      setErrorReason("");
      setValidLink(false);
      setSuccess("Senha criada com sucesso. Redirecionando para o login...");

      window.setTimeout(() => {
        router.replace("/login?sucesso=senha_definida");
      }, 1400);
    } catch {
      setError("Erro inesperado ao cadastrar sua senha.");
    } finally {
      setSubmitting(false);
    }
  }

  const expiryLabel = expiresAt
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(expiresAt))
    : null;

  function Requirement({
    valid,
    children,
  }: {
    valid: boolean;
    children: string;
  }) {
    return (
      <li className={valid ? styles.validRule : styles.invalidRule}>
        {valid ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
        <span>{children}</span>
      </li>
    );
  }

  const remainingLabel =
    remainingOpenings === null
      ? ""
      : " Restam " +
        remainingOpenings +
        " abertura" +
        (remainingOpenings === 1 ? "" : "s") +
        " após esta.";

  const expiryText = expiryLabel ? " Validade: " + expiryLabel + "." : "";

  return (
    <main className="auth-page">
      <section className={styles.card + " auth-card"}>
        <Brand href="/" />

        <div className={styles.heading}>
          <span className={styles.icon}>
            <KeyRound size={24} />
          </span>
          <div>
            <h1>Primeiro acesso</h1>
            <p>Crie sua senha para acessar o Prosperity Pay.</p>
            {email ? <strong>{email}</strong> : null}
          </div>
        </div>

        {validating ? (
          <div className={styles.info}>Validando seu link de acesso...</div>
        ) : !validLink ? (
          <div className={styles.unavailable}>
            <div className={styles.error}>
              {error || "Este link não está mais disponível."}
            </div>

            {errorReason === "password_set" ? (
              <button
                type="button"
                className="primary-button"
                onClick={() => router.push("/login")}
              >
                Fazer login
              </button>
            ) : (
              <button
                type="button"
                className="secondary-button"
                onClick={() => router.push("/cadastro")}
              >
                Solicitar novo acesso
              </button>
            )}
          </div>
        ) : (
          <form className={styles.form} onSubmit={submit}>
            <div className={styles.info}>
              <strong>Link protegido</strong>
              <span>
                Válido por 24 horas e com limite de 3 aberturas.
                {remainingLabel}
                {expiryText}
              </span>
            </div>

            <label className={styles.field}>
              Nova senha
              <span className={styles.passwordField}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Digite sua nova senha"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            <label className={styles.field}>
              Confirmar senha
              <span className={styles.passwordField}>
                <input
                  type={showConfirmation ? "text" : "password"}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="Confirme sua senha"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmation((value) => !value)}
                  aria-label={
                    showConfirmation ? "Ocultar confirmação" : "Mostrar confirmação"
                  }
                >
                  {showConfirmation ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            {confirmation && !passwordsMatch ? (
              <p className={styles.mismatch}>As senhas não conferem.</p>
            ) : null}

            <div className={styles.rulesBox}>
              <div className={styles.rulesHeader}>
                <strong>Requisitos da senha</strong>
                <span>{requirementsMet}/5</span>
              </div>

              <ul>
                <Requirement valid={requirements.minimum}>
                  Mínimo de 8 caracteres
                </Requirement>
                <Requirement valid={requirements.uppercase}>
                  Uma letra maiúscula
                </Requirement>
                <Requirement valid={requirements.lowercase}>
                  Uma letra minúscula
                </Requirement>
                <Requirement valid={requirements.number}>Um número</Requirement>
                <Requirement valid={requirements.special}>
                  Um caractere especial
                </Requirement>
              </ul>

              <small>Para continuar, cumpra pelo menos 4 dos 5 requisitos.</small>
            </div>

            {error ? <div className={styles.error}>{error}</div> : null}
            {success ? <div className={styles.success}>{success}</div> : null}

            <button
              className="primary-button"
              disabled={submitting || !validPassword || !validLink}
            >
              {submitting ? "Salvando..." : "Criar senha e acessar"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
