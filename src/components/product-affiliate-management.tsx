"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, MailPlus, Settings2, ShieldCheck, SlidersHorizontal, UserPlus, UsersRound } from "lucide-react";
import {
  ProductAffiliateSettingsDialog,
  type AffiliateOfferSettings,
  type AffiliateProductSettings,
  type AffiliateProgramSettings,
} from "@/components/product-affiliate-settings-dialog";
import {
  PartnerIndividualCommissionDialog,
  PartnerOfferCommissionFields,
  readPartnerAddonCommissionOverrides,
  readPartnerOfferCommissionOverrides,
  type PartnerAddonCommissionOverride,
  type PartnerAddonSettings,
  type PartnerOfferCommissionOverride,
} from "@/components/partner-offer-commission-fields";
import { requestJson } from "@/lib/operational";
import styles from "./product-partner-management.module.css";

type AffiliateMember = {
  id: string;
  code: string;
  status: string;
  partner_type: "affiliate" | "accredited";
  created_at?: string;
  affiliate_commission_bps_override: number | null;
  offer_commission_overrides: PartnerOfferCommissionOverride[];
  addon_commission_overrides: PartnerAddonCommissionOverride[];
  profiles: { full_name: string; email: string } | null;
};

function StatusBadge({ status }: { status: string }) {
  const label: Record<string, string> = {
    active: "Ativo",
    pending: "Pendente",
    rejected: "Recusado",
    blocked: "Bloqueado",
    cancelled: "Cancelado",
  };
  return (
    <span className={`${styles.badge} ${status === "active" ? styles.badgeActive : status === "pending" ? styles.badgePending : ""}`}>
      {label[status] ?? status}
    </span>
  );
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
}

export function ProductAffiliateManagement({ id }: { id: string }) {
  const [program, setProgram] = useState<AffiliateProgramSettings | null>(null);
  const [offers, setOffers] = useState<AffiliateOfferSettings[]>([]);
  const [addons, setAddons] = useState<PartnerAddonSettings[]>([]);
  const [product, setProduct] = useState<AffiliateProductSettings | null>(null);
  const [members, setMembers] = useState<AffiliateMember[]>([]);
  const [selectedMember, setSelectedMember] = useState<AffiliateMember | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [programUrl, setProgramUrl] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await requestJson<{
        program: AffiliateProgramSettings | null;
        memberships: AffiliateMember[];
        offers: AffiliateOfferSettings[];
        addons: PartnerAddonSettings[];
        product: AffiliateProductSettings;
      }>(`/api/products/${id}/affiliates`);
      const nextMembers = (data.memberships ?? []).filter((member) => member.partner_type === "affiliate");
      setProgram(data.program);
      setMembers(nextMembers);
      setOffers(data.offers ?? []);
      setAddons(data.addons ?? []);
      setProduct(data.product ?? null);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar afiliados.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setProgramUrl(
      program?.id && program.mode !== "invite"
        ? `${window.location.origin}/afiliados/participar/${program.id}`
        : "",
    );
  }, [program?.id, program?.mode]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const formData = new FormData(form);
      const email = formData.get("email");
      const offerCommissionOverrides = readPartnerOfferCommissionOverrides(formData, offers);
      const addonCommissionOverrides = program?.commission_addons
        ? readPartnerAddonCommissionOverrides(formData, addons)
        : [];
      const result = await requestJson<{ invitationPath: string }>(
        `/api/products/${id}/affiliates/invite`,
        {
          method: "POST",
          body: JSON.stringify({
            email,
            partnerType: "affiliate",
            offerCommissionOverrides,
            addonCommissionOverrides,
          }),
        },
      );
      setInviteUrl(`${location.origin}${result.invitationPath}`);
      setMessage("Convite enviado por e-mail ao afiliado.");
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao criar convite.");
    } finally {
      setBusy(false);
    }
  }

  async function setMemberStatus(memberId: string, status: "active" | "blocked") {
    setBusy(true);
    setError("");
    try {
      await requestJson(`/api/products/${id}/affiliates/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao atualizar afiliado.");
    } finally {
      setBusy(false);
    }
  }

  async function saveIndividualSettings(
    member: AffiliateMember,
    input: {
      offerCommissionOverrides: Array<{ offerId: string; commissionBps: number | null }>;
      addonCommissionOverrides?: Array<{ addonId: string; commissionBps: number | null }>;
    },
  ) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestJson(`/api/products/${id}/affiliates/${member.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          offerCommissionOverrides: input.offerCommissionOverrides,
          ...(input.addonCommissionOverrides
            ? { addonCommissionOverrides: input.addonCommissionOverrides }
            : {}),
        }),
      });
      setMessage(`Configurações individuais de ${member.profiles?.full_name || "afiliado"} salvas.`);
      setSelectedMember(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar configurações individuais.");
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite(member: AffiliateMember) {
    const url = `${location.origin}/convites/afiliacao?code=${encodeURIComponent(member.code)}`;
    await copy(url);
    setCopied(member.id);
    setTimeout(() => setCopied(""), 1200);
  }

  const activeCount = members.filter((item) => item.status === "active").length;
  const pendingCount = members.filter((item) => item.status === "pending").length;
  const persistedInvite = program?.active === true && program.mode === "invite";

  return (
    <div className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.heroTitle}>
          <div className={styles.heroIcon}><UsersRound size={19} /></div>
          <div>
            <small>Parcerias</small>
            <h2>Programa de afiliados</h2>
            <p>Gerencie afiliados, links de indicação e comissões deste produto.</p>
          </div>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.heroButtonGroup}>
            <button type="button" className={styles.primary} onClick={() => setSettingsOpen(true)}>
              <Settings2 size={15} />{program ? "Configurar afiliação" : "Configurar e habilitar"}
            </button>
            {program?.mode === "invite" && (
              <button type="button" className={styles.secondary} onClick={() => setInviteOpen(true)}>
                <UserPlus size={15} />Convidar afiliado
              </button>
            )}
          </div>
          <div className={styles.statusBox}>
            <span>
              <strong>{program?.active ? "Programa ativo" : "Programa pausado"}</strong>
              <small>{activeCount} ativos · {pendingCount} pendentes</small>
            </span>
            <i className={`${styles.statusDot} ${program?.active ? styles.statusDotOn : ""}`} />
          </div>
        </div>
      </section>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.success} role="status">{message}</p>}

      {program?.active && program.mode !== "invite" && programUrl && (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <span><Link2 size={16} /></span>
              <div><h3>Link para novos afiliados</h3><p>Compartilhe este endereço para inscrição no programa.</p></div>
            </div>
          </div>
          <div className={styles.linkBox}>
            <Link2 size={15} /><code>{programUrl}</code>
            <button type="button" className={styles.secondary} onClick={() => void copy(programUrl)}>
              <Copy size={14} />Copiar
            </button>
          </div>
          {program.mode === "approval" && (
            <p className={styles.notice}>As solicitações recebidas por este link ficarão pendentes até sua aprovação.</p>
          )}
        </section>
      )}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span><ShieldCheck size={16} /></span>
            <div><h3>Afiliados do produto</h3><p>Acompanhe solicitações, aprovações, comissão individual e bloqueios.</p></div>
          </div>
        </div>

        {members.length ? (
          <div className={styles.list}>
            {members.map((member) => (
              <div className={styles.row} key={member.id}>
                <div className={styles.identity}>
                  <strong>{member.profiles?.full_name || "Afiliado"}</strong>
                  <small>{member.profiles?.email || "E-mail não disponível"}</small>
                </div>
                <code className={styles.code}>{member.code}</code>
                <div className={styles.individualSummary}>
                  <span>Configuração individual</span>
                  <strong>
                    {member.offer_commission_overrides.length + member.addon_commission_overrides.length
                      ? `${member.offer_commission_overrides.length + member.addon_commission_overrides.length} regra(s) personalizada(s)`
                      : "Padrão das ofertas"}
                  </strong>
                  <small>
                    {member.offer_commission_overrides.length + member.addon_commission_overrides.length
                      ? "Demais ofertas e adicionais continuam herdando as regras padrão."
                      : "Nenhuma exceção de comissão configurada."}
                  </small>
                </div>
                <StatusBadge status={member.status} />
                <div className={styles.rowActions}>
                  <button type="button" className={styles.secondary} disabled={busy} onClick={() => setSelectedMember(member)}>
                    <SlidersHorizontal size={14} />Config. individuais
                  </button>
                  {member.status === "pending" && program?.mode === "approval" && (
                    <button type="button" className={`${styles.secondary} ${styles.positive}`} disabled={busy} onClick={() => void setMemberStatus(member.id, "active")}>
                      <Check size={14} />Aprovar
                    </button>
                  )}
                  {member.status === "pending" && program?.mode === "invite" && (
                    <button type="button" className={styles.secondary} onClick={() => void copyInvite(member)}>
                      {copied === member.id ? <Check size={14} /> : <Copy size={14} />}Convite
                    </button>
                  )}
                  {(member.status === "blocked" || member.status === "rejected" || member.status === "cancelled") && (
                    <button type="button" className={`${styles.secondary} ${styles.positive}`} disabled={busy} onClick={() => void setMemberStatus(member.id, "active")}>
                      <Check size={14} />Ativar
                    </button>
                  )}
                  {member.status === "active" && (
                    <button type="button" className={styles.danger} disabled={busy} onClick={() => void setMemberStatus(member.id, "blocked")}>
                      Bloquear
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>Nenhum afiliado vinculado a este produto ainda.</div>
        )}
      </section>

      {settingsOpen && (
        <ProductAffiliateSettingsDialog
          productId={id}
          program={program}
          offers={offers}
          product={product}
          onClose={() => setSettingsOpen(false)}
          onSaved={(nextProgram, nextOffers) => {
            setProgram(nextProgram);
            setOffers(nextOffers);
            setSettingsOpen(false);
            setMessage(nextProgram.active ? "Programa de afiliados configurado e ativo." : "Configurações salvas. O programa permanece pausado.");
          }}
        />
      )}

      {inviteOpen && (
        <AffiliateInviteDialog
          busy={busy}
          enabled={persistedInvite}
          inviteUrl={inviteUrl}
          error={error}
          message={message}
          offers={offers}
          addons={addons}
          commissionAddonsEnabled={Boolean(program?.commission_addons)}
          onInvite={invite}
          onClose={() => setInviteOpen(false)}
        />
      )}

      {selectedMember && (
        <PartnerIndividualCommissionDialog
          partnerName={selectedMember.profiles?.full_name || "Afiliado"}
          partnerLabel="Afiliado"
          offers={offers}
          overrides={selectedMember.offer_commission_overrides}
          addons={addons}
          addonOverrides={selectedMember.addon_commission_overrides}
          commissionAddonsEnabled={Boolean(program?.commission_addons)}
          busy={busy}
          onClose={() => setSelectedMember(null)}
          onSave={(input) => saveIndividualSettings(selectedMember, input)}
        />
      )}
    </div>
  );
}

function AffiliateInviteDialog({
  busy,
  enabled,
  inviteUrl,
  error,
  message,
  offers,
  addons,
  commissionAddonsEnabled,
  onInvite,
  onClose,
}: {
  busy: boolean;
  enabled: boolean;
  inviteUrl: string;
  error: string;
  message: string;
  offers: AffiliateOfferSettings[];
  addons: PartnerAddonSettings[];
  commissionAddonsEnabled: boolean;
  onInvite: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className={styles.inviteDialog} onClose={onClose} onCancel={(event) => { if (busy) event.preventDefault(); }}>
      <header className={styles.inviteModalHeader}>
        <div>
          <span><MailPlus size={17} /></span>
          <div><h3>Convidar afiliado</h3><p>Informe o e-mail da conta Prosperity Pay que receberá o convite.</p></div>
        </div>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => ref.current?.close()}>Fechar</button>
      </header>
      <div className={styles.inviteModalBody}>
        <form className={styles.inviteForm} onSubmit={(event) => void onInvite(event)}>
          <div className={styles.inviteGrid}>
            <label className={styles.field}>
              E-mail do afiliado
              <input name="email" type="email" placeholder="afiliado@exemplo.com" required autoFocus />
            </label>
          </div>
          <PartnerOfferCommissionFields
            offers={offers}
            addons={addons}
            commissionAddonsEnabled={commissionAddonsEnabled}
          />
          <div className={styles.inviteSubmit}>
            <button className={styles.primary} disabled={busy || !enabled}>
              <UserPlus size={15} />{busy ? "Enviando..." : "Enviar convite"}
            </button>
          </div>
        </form>
        {!enabled && <p className={styles.notice}>Ative o programa e selecione o modo Somente convite nas configurações para enviar convites.</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
        {message && <p className={styles.success} role="status">{message}</p>}
        {inviteUrl && (
          <div className={styles.linkBox}>
            <Link2 size={15} /><code>{inviteUrl}</code>
            <button type="button" className={styles.secondary} onClick={() => void copy(inviteUrl)}>
              <Copy size={14} />Copiar
            </button>
          </div>
        )}
      </div>
    </dialog>
  );
}
