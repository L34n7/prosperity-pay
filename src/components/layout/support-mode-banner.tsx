"use client";

import { Eye, LogOut } from "lucide-react";
import { useState } from "react";
import styles from "./support-mode-banner.module.css";

export function SupportModeBanner({
  name,
  email,
}: {
  name: string;
  email: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function exitSupportMode() {
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/support/exit", { method: "POST" });
      const result = (await response.json()) as {
        ok?: boolean;
        redirectUrl?: string;
        error?: string;
      };

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "Não foi possível sair do modo suporte.");
      }

      window.location.assign(result.redirectUrl || "/admin/usuarios");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível sair do modo suporte.",
      );
      setBusy(false);
    }
  }

  return (
    <div className={styles.banner} role="status">
      <div className={styles.identity}>
        <span className={styles.icon}>
          <Eye size={17} />
        </span>
        <span>
          <strong>Modo suporte</strong>
          <span className={styles.separator}>·</span>
          Visualizando como <b>{name}</b>
          <span className={styles.email}>{email}</span>
        </span>
      </div>

      <div className={styles.actions}>
        <span className={styles.readOnly}>Somente leitura</span>
        {error ? <span className={styles.error}>{error}</span> : null}
        <button type="button" onClick={exitSupportMode} disabled={busy}>
          <LogOut size={15} />
          {busy ? "Saindo..." : "Sair do modo suporte"}
        </button>
      </div>
    </div>
  );
}
