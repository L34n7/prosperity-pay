"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Layers3, ReceiptText } from "lucide-react";
import { requestJson } from "@/lib/operational";
import styles from "./product-partner-management.module.css";

type SubscriptionItem = {
  id: string;
  item_type: "base" | "addon";
  code: string;
  description: string;
  unit_amount_cents: number;
  quantity: number;
};

type PendingChange = {
  id: string;
  change_type: string;
  status: string;
  quoted_target_amount_cents: number;
  proration_amount_cents: number;
  effective_mode: string;
  effective_at: string | null;
};

type Subscription = {
  id: string;
  status: string;
  billing_model: string;
  base_amount_cents: number;
  current_amount_cents: number;
  currency: string;
  current_period_start: string | null;
  current_period_end: string | null;
  next_due_at: string | null;
  cycle_number: number;
  customer: { id: string; name: string | null; email: string } | null;
  offer: { id: string; name: string; checkout_slug: string } | null;
  items: SubscriptionItem[];
  pendingChanges: PendingChange[];
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function date(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    active: "Ativa", pending: "Pendente", past_due: "Vencida", paused: "Pausada",
    cancelled: "Cancelada", expired: "Expirada", awaiting_payment: "Aguardando pagamento",
    scheduled: "Agendada", applying: "Aplicando", payment_approved: "Pagamento aprovado",
  };
  return labels[status] ?? status;
}

export function ProductSubscriptionsManagement({ productId }: { productId: string }) {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await requestJson<{ subscriptions: Subscription[] }>(`/api/products/${productId}/subscriptions`);
      setSubscriptions(result.subscriptions ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar assinaturas.");
    } finally { setLoading(false); }
  }, [productId]);

  useEffect(() => { void load(); }, [load]);

  return <div className={styles.shell}>
    <section className={styles.hero}>
      <div className={styles.heroTitle}>
        <div className={styles.heroIcon}><ReceiptText size={19}/></div>
        <div><small>Billing pré-pago</small><h2>Assinaturas</h2><p>Composição contratada, ciclo pago, vencimento e alterações pendentes.</p></div>
      </div>
      <div className={styles.statusBox}><span><strong>{subscriptions.filter(item => item.status === "active").length} ativas</strong><small>{subscriptions.length} no total</small></span></div>
    </section>

    {error && <p className={styles.error} role="alert">{error}</p>}
    {loading ? <div className={styles.empty}>Carregando assinaturas...</div> : !subscriptions.length ? <div className={styles.empty}>Ainda não existem assinaturas para este produto.</div> :
      <div className={styles.list}>{subscriptions.map(subscription => <section className={styles.card} key={subscription.id}>
        <div className={styles.cardHeader}>
          <div><span><Layers3 size={16}/></span><div><h3>{subscription.customer?.name || subscription.customer?.email || "Cliente"}</h3><p>{subscription.offer?.name || "Plano"} · ciclo {subscription.cycle_number}</p></div></div>
          <span className={`${styles.badge} ${subscription.status === "active" ? styles.badgeActive : ""}`}>{statusLabel(subscription.status)}</span>
        </div>

        <div className={styles.list}>
          {subscription.items.map(item => <div className={styles.row} key={item.id}>
            <div className={styles.identity}><strong>{item.description}</strong><small>{item.item_type === "base" ? "Plano base" : "Adicional"} · {item.code}</small></div>
            <span className={styles.detail}>{item.quantity} × {money(item.unit_amount_cents)}</span>
            <strong className={styles.detail}>{money(item.unit_amount_cents * item.quantity)}</strong>
            <span className={styles.badge}>{item.item_type === "base" ? "Base" : "Add-on"}</span>
            <span/>
          </div>)}
        </div>

        <div className={styles.configFooter}>
          <div className={styles.meta}>
            <CalendarClock size={13}/> Período {date(subscription.current_period_start)} → {date(subscription.current_period_end)} · próximo vencimento {date(subscription.next_due_at)}
          </div>
          <strong>{money(subscription.current_amount_cents)}/ciclo</strong>
        </div>

        {subscription.pendingChanges.length > 0 && <div style={{display:"grid",gap:7,marginTop:12}}>
          <div className={styles.sectionTitle}><h3>Alterações pendentes</h3><small>Só entram em vigor conforme a regra de pagamento.</small></div>
          {subscription.pendingChanges.map(change => <div className={styles.notice} key={change.id}>
            <strong>{statusLabel(change.status)}</strong> · {change.change_type.replaceAll("_"," ")} · destino {money(change.quoted_target_amount_cents)}
            {change.proration_amount_cents > 0 ? ` · pró-rata ${money(change.proration_amount_cents)}` : ""}
            {change.effective_at ? ` · vigência ${date(change.effective_at)}` : ""}
          </div>)}
        </div>}
      </section>)}</div>}
  </div>;
}
