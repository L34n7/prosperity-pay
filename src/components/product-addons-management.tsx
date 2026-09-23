"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PackagePlus, Pencil, Plus, Power, Trash2 } from "lucide-react";
import { requestJson } from "@/lib/operational";
import styles from "./product-partner-management.module.css";

type Addon = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  unit_amount_cents: number;
  currency: string;
  active: boolean;
  max_quantity: number | null;
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function cents(value: FormDataEntryValue | null) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Math.round(parsed * 100);
}

export function ProductAddonsManagement({ productId }: { productId: string }) {
  const [addons, setAddons] = useState<Addon[]>([]);
  const [editing, setEditing] = useState<Addon | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await requestJson<{ addons: Addon[] }>(`/api/products/${productId}/addons`);
      setAddons(result.addons ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar adicionais.");
    }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true); setError(""); setMessage("");
    try {
      const payload = {
        name: String(data.get("name") ?? ""),
        code: String(data.get("code") ?? ""),
        description: String(data.get("description") ?? ""),
        unitAmountCents: cents(data.get("price")),
        maxQuantity: String(data.get("maxQuantity") ?? "").trim() || null,
        active: data.get("active") === "on",
      };
      await requestJson(
        editing ? `/api/products/${productId}/addons/${editing.id}` : `/api/products/${productId}/addons`,
        { method: editing ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      form.reset();
      setEditing(null);
      setMessage(editing ? "Adicional atualizado. Assinaturas existentes mantêm o preço contratado." : "Adicional criado.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar adicional.");
    } finally { setBusy(false); }
  }

  async function toggle(addon: Addon) {
    setBusy(true); setError(""); setMessage("");
    try {
      await requestJson(`/api/products/${productId}/addons/${addon.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !addon.active }),
      });
      setMessage(addon.active ? "Adicional desativado para novas contratações." : "Adicional reativado.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao alterar adicional.");
    } finally { setBusy(false); }
  }

  async function remove(addon: Addon) {
    if (!window.confirm(`Excluir o adicional "${addon.name}"? Se houver histórico de assinatura, a exclusão será bloqueada.`)) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await requestJson(`/api/products/${productId}/addons/${addon.id}`, { method: "DELETE" });
      setMessage("Adicional excluído.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao excluir adicional.");
    } finally { setBusy(false); }
  }

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div className={styles.heroTitle}>
        <div className={styles.heroIcon}><PackagePlus size={19}/></div>
        <div><small>Assinatura</small><h2>Catálogo de adicionais</h2><p>Itens recorrentes que podem compor a mensalidade sem criar novas ofertas combinadas.</p></div>
      </div>
      <div className={styles.statusBox}><span><strong>{addons.filter(item => item.active).length} ativos</strong><small>Preço congelado por contratação</small></span></div>
    </section>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {message && <p className={styles.success} role="status">{message}</p>}

    <section className={styles.card}>
      <div className={styles.cardHeader}><div><span><Plus size={16}/></span><div><h3>{editing ? "Editar adicional" : "Novo adicional"}</h3><p>O código é usado pelas integrações e não muda o preço de contratos existentes.</p></div></div></div>
      <form className={styles.formGrid} key={editing?.id ?? "new"} onSubmit={event => void save(event)}>
        <label className={styles.field}>Nome<input name="name" required maxLength={180} defaultValue={editing?.name ?? ""} placeholder="Número WhatsApp adicional"/></label>
        <label className={styles.field}>Código<input name="code" required={!editing} disabled={Boolean(editing)} defaultValue={editing?.code ?? ""} placeholder="whatsapp_number"/></label>
        <label className={styles.field}>Valor mensal (R$)<input name="price" type="number" min="0.01" step="0.01" required defaultValue={editing ? (editing.unit_amount_cents / 100).toFixed(2) : ""} placeholder="60,00"/></label>
        <button className={styles.primary} disabled={busy}>{busy ? "Salvando..." : editing ? "Salvar" : "Adicionar"}</button>
        <label className={styles.field}>Descrição<input name="description" maxLength={1000} defaultValue={editing?.description ?? ""} placeholder="Opcional"/></label>
        <label className={styles.field}>Quantidade máxima<input name="maxQuantity" type="number" min="1" defaultValue={editing?.max_quantity ?? ""} placeholder="Sem limite"/></label>
        <label className={styles.detail}><input name="active" type="checkbox" defaultChecked={editing?.active ?? true}/> Disponível para novas contratações</label>
        {editing && <button type="button" className={styles.secondary} onClick={() => setEditing(null)}>Cancelar edição</button>}
      </form>
    </section>

    <section className={styles.card}>
      <div className={styles.cardHeader}><div><span><PackagePlus size={16}/></span><div><h3>Adicionais cadastrados</h3><p>Alterar o preço afeta apenas novas contratações; assinaturas ativas usam o preço congelado no item.</p></div></div></div>
      {addons.length ? <div className={styles.list}>{addons.map(addon => <div className={styles.row} key={addon.id}>
        <div className={styles.identity}><strong>{addon.name}</strong><small>{addon.description || "Sem descrição"}</small></div>
        <code className={styles.code}>{addon.code}</code>
        <div className={styles.detail}><strong>{money(addon.unit_amount_cents)}/mês</strong>{addon.max_quantity ? <><br/>Máx. {addon.max_quantity}</> : null}</div>
        <span className={`${styles.badge} ${addon.active ? styles.badgeActive : ""}`}>{addon.active ? "Ativo" : "Inativo"}</span>
        <div className={styles.rowActions}>
          <button className={styles.secondary} disabled={busy} onClick={() => setEditing(addon)}><Pencil size={14}/>Editar</button>
          <button className={styles.secondary} disabled={busy} onClick={() => void toggle(addon)}><Power size={14}/>{addon.active ? "Desativar" : "Ativar"}</button>
          <button className={styles.danger} disabled={busy} onClick={() => void remove(addon)}><Trash2 size={14}/>Excluir</button>
        </div>
      </div>)}</div> : <div className={styles.empty}>Nenhum adicional cadastrado. Você pode começar, por exemplo, com “Número WhatsApp adicional”.</div>}
    </section>
  </div>;
}
