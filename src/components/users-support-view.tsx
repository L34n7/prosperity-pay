"use client";

import { Eye, Search, ShieldCheck, UserRound, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import styles from "./users-support-view.module.css";

type SupportUser = {
  id: string;
  fullName: string | null;
  email: string | null;
  createdAt: string;
  roles: string[];
};

function roleLabel(role: string) {
  if (role === "admin") return "Administrador";
  if (role === "finance_operator") return "Financeiro";
  return role;
}

export function UsersSupportView({ users }: { users: SupportUser[] }) {
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return users;

    return users.filter((user) =>
      [user.fullName, user.email, ...user.roles]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    );
  }, [query, users]);

  async function accessAsSupport(user: SupportUser) {
    const confirmed = window.confirm(
      `Abrir o sistema como suporte para ${user.fullName || user.email || "este usuário"}?\n\nA sessão dura 30 minutos, é auditada e funciona em modo somente leitura.`,
    );
    if (!confirmed) return;

    setBusyId(user.id);
    setError("");

    try {
      const response = await fetch(
        `/api/admin/users/${encodeURIComponent(user.id)}/support`,
        { method: "POST" },
      );
      const result = (await response.json()) as {
        ok?: boolean;
        redirectUrl?: string;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Não foi possível iniciar o modo suporte.");
      }

      window.location.assign(result.redirectUrl || "/dashboard?modo_suporte=1");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível iniciar o modo suporte.",
      );
      setBusyId("");
    }
  }

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Acesse a visão do usuário para diagnosticar problemas sem alterar a senha ou os dados da conta."
      />

      <div className={styles.stack}>
        <section className={styles.summary}>
          <div>
            <span className={styles.summaryIcon}>
              <Users size={20} />
            </span>
            <div>
              <strong>{users.length}</strong>
              <span>usuários cadastrados</span>
            </div>
          </div>
          <div className={styles.security}>
            <ShieldCheck size={18} />
            <span>
              Modo suporte auditado · sessão de 30 minutos · somente leitura
            </span>
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.toolbar}>
            <label className={styles.search}>
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nome ou e-mail"
                autoComplete="off"
              />
            </label>
            <span className={styles.resultCount}>
              {filtered.length} resultado{filtered.length === 1 ? "" : "s"}
            </span>
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.rows}>
            {filtered.length ? (
              filtered.map((user) => (
                <article className={styles.row} key={user.id}>
                  <div className={styles.person}>
                    <span className={styles.avatar}>
                      <UserRound size={18} />
                    </span>
                    <div>
                      <strong>{user.fullName || "Usuário sem nome"}</strong>
                      <span>{user.email || "E-mail não informado"}</span>
                    </div>
                  </div>

                  <div className={styles.meta}>
                    <span>
                      Cadastro{" "}
                      {new Intl.DateTimeFormat("pt-BR", {
                        dateStyle: "short",
                      }).format(new Date(user.createdAt))}
                    </span>
                    <div className={styles.roles}>
                      {user.roles.length ? (
                        user.roles.map((role) => (
                          <span key={role}>{roleLabel(role)}</span>
                        ))
                      ) : (
                        <span>Usuário</span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    className={styles.accessButton}
                    disabled={Boolean(busyId)}
                    onClick={() => accessAsSupport(user)}
                  >
                    <Eye size={16} />
                    {busyId === user.id
                      ? "Abrindo..."
                      : "Acessar como suporte"}
                  </button>
                </article>
              ))
            ) : (
              <div className={styles.empty}>
                Nenhum usuário encontrado para esta busca.
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
