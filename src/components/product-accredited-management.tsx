"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Link2, MailPlus, ShieldCheck, SlidersHorizontal, Sparkles, UserRoundCheck, UsersRound } from "lucide-react";
import type {
  AffiliateOfferSettings,
  AffiliateProductSettings,
  AffiliateProgramSettings,
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

type PartnerMember = {
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

export function ProductAccreditedManagement({ id }: { id: string }) {
  const [program, setProgram] = useState<AffiliateProgramSettings | null>(null);
  const [members, setMembers] = useState<PartnerMember[]>([]);
  const [eligibleAffiliates, setEligibleAffiliates] = useState<PartnerMember[]>([]);
  const [offers, setOffers] = useState<AffiliateOfferSettings[]>([]);
  const [addons, setAddons] = useState<PartnerAddonSettings[]>([]);
  const [selectedMember, setSelectedMember] = useState<PartnerMember | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [evolveOpen, setEvolveOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await requestJson<{
        program: AffiliateProgramSettings | null;
        memberships: PartnerMember[];
        offers: AffiliateOfferSettings[];
        addons: PartnerAddonSettings[];
        product: AffiliateProductSettings;
      }>(`/api/products/${id}/affiliates`);

      const all = data.memberships ?? [];
      const accredited = all.filter((member) => member.partner_type === "accredited");
      const affiliates = all.filter(
        (member) => member.partner_type === "affiliate" && member.status === "active",
      );

      setProgram(data.program);
      setMembers(accredited);
      setEligibleAffiliates(affiliates);
      setOffers(data.offers ?? []);
      setAddons(data.addons ?? []);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao carregar credenciados.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

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
            partnerType: "accredited",
            offerCommissionOverrides,
            addonCommissionOverrides,
          }),
        },
      );
      setInviteUrl(`${location.origin}${result.invitationPath}`);
      setMessage("Convite de credenciado enviado por e-mail.");
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao convidar credenciado.");
    } finally {
      setBusy(false);
    }
  }

  async function evolveAffiliate(memberId: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await requestJson(`/api/products/${id}/affiliates/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify({ partnerType: "accredited" }),
      });
      setMessage("Afiliado evoluído para Credenciado sem perder histórico, link ou comissões.");
      setEvolveOpen(false);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao evoluir afiliado.");
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
      setError(cause instanceof Error ? cause.message : "Falha ao atualizar credenciado.");
    } finally {
      setBusy(false);
    }
  }

  async function saveIndividualSettings(
    member: PartnerMember,
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
      setMessage(`Configurações individuais de ${member.profiles?.full_name || "credenciado"} salvas.`);
      setSelectedMember(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha ao salvar configurações individuais.");
      throw cause;
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite(member: PartnerMember) {
    const url = `${location.origin}/convites/afiliacao?code=${encodeURIComponent(member.code)}`;
    await copy(url);
    setCopied(member.id);
    setTimeout(() => setCopied(""), 1200);
  }

  const activeCount = members.filter((item) => item.status === "active").length;
  const pendingCount = members.filter((item) => item.status === "pending").length;
  const canInvite = program?.active === true && program.mode === "invite";

  return (
    <div className={styles.shell}>
      <section className={styles.hero}>
        <div className={styles.heroTitle}>
          <div className={styles.heroIcon}><UserRoundCheck size={19} /></div>
          <div>
            <small>Parcerias</small>
            <h2>Credenciados</h2>
            <p>Credenciados usam a mesma estrutura de links e comissões dos afiliados, com uma carteira de clientes mais destacada.</p>
          </div>
        </div>
        <div className={styles.heroActions}>
          <div className={styles.heroButtonGroup}>
            <button type="button" className={styles.primary} onClick={() => setInviteOpen(true)} disabled={!canInvite}>
              <UserRoundCheck size={15} />Convidar credenciado
            </button>
            <button type="button" className={styles.secondary} onClick={() => setEvolveOpen(true)} disabled={!eligibleAffiliates.length}>
              <Sparkles size={15} />Evoluir afiliado
            </button>
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

      {!canInvite && (
        <p className={styles.notice}>
          Para convidar um novo credenciado por e-mail, mantenha o programa ativo no modo Somente convite. Você ainda pode evoluir um afiliado ativo.
        </p>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
      {message && <p className={styles.success} role="status">{message}</p>}

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <div>
            <span><ShieldCheck size={16} /></span>
            <div><h3>Credenciados do produto</h3><p>Gerencie comissão individual, convites, status e bloqueios.</p></div>
          </div>
        </div>

        {members.length ? (
          <div className={styles.list}>
            {members.map((member) => (
              <div className={styles.row} key={member.id}>
                <div className={styles.identity}>
                  <strong>{member.profiles?.full_name || "Credenciado"}</strong>
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
                  {member.status === "pending" && (
                    <button type="button" className={styles.secondary} onClick={() => void copyInvite(member)}>
                      {copied === member.id ? <Check size={14} /> : <Copy size={14} />}Convite
                    </button>
                  )}
                  {(member.status === "blocked" || member.status === "rejected" || member.status === "cancelled") && (
                    <button type="button" className={styles.secondary} disabled={busy} onClick={() => void setMemberStatus(member.id, "active")}>
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
          <div className={styles.empty}>Nenhum credenciado vinculado a este produto ainda.</div>
        )}
      </section>

      {inviteOpen && (
        <AccreditedInviteDialog
          busy={busy}
          enabled={canInvite}
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

      {evolveOpen && (
        <EvolveAffiliateDialog
          busy={busy}
          affiliates={eligibleAffiliates}
          onEvolve={evolveAffiliate}
          onClose={() => setEvolveOpen(false)}
        />
      )}

      {selectedMember && (
        <PartnerIndividualCommissionDialog
          partnerName={selectedMember.profiles?.full_name || "Credenciado"}
          partnerLabel="Credenciado"
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

function AccreditedInviteDialog({
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
          <div><h3>Convidar credenciado</h3><p>Envie um convite direto para uma conta Prosperity Pay.</p></div>
        </div>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => ref.current?.close()}>Fechar</button>
      </header>
      <div className={styles.inviteModalBody}>
        <form className={styles.inviteForm} onSubmit={(event) => void onInvite(event)}>
          <div className={styles.inviteGrid}>
            <label className={styles.field}>
              E-mail do credenciado
              <input name="email" type="email" placeholder="credenciado@exemplo.com" required autoFocus />
            </label>
          </div>
          <PartnerOfferCommissionFields
            offers={offers}
            addons={addons}
            commissionAddonsEnabled={commissionAddonsEnabled}
          />
          <div className={styles.inviteSubmit}>
            <button className={styles.primary} disabled={busy || !enabled}>
              <UserRoundCheck size={15} />{busy ? "Enviando..." : "Enviar convite"}
            </button>
          </div>
        </form>
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

function EvolveAffiliateDialog({
  busy,
  affiliates,
  onEvolve,
  onClose,
}: {
  busy: boolean;
  affiliates: PartnerMember[];
  onEvolve: (memberId: string) => Promise<void>;
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
          <span><Sparkles size={17} /></span>
          <div>
            <h3>Evoluir afiliado</h3>
            <p>Transforme um afiliado ativo em Credenciado sem perder link, clientes, histórico ou comissões.</p>
          </div>
        </div>
        <button type="button" className={styles.secondary} disabled={busy} onClick={() => ref.current?.close()}>Fechar</button>
      </header>
      <div className={styles.inviteModalBody}>
        {affiliates.length ? (
          <div className={styles.evolveList}>
            {affiliates.map((affiliate) => (
              <div className={styles.evolveRow} key={affiliate.id}>
                <div className={styles.identity}>
                  <strong>{affiliate.profiles?.full_name || "Afiliado"}</strong>
                  <small>{affiliate.profiles?.email || "E-mail não disponível"} · {affiliate.code}</small>
                </div>
                <button type="button" className={styles.primary} disabled={busy} onClick={() => void onEvolve(affiliate.id)}>
                  <Sparkles size={14} />Evoluir para Credenciado
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>Não há afiliados ativos disponíveis para evolução.</div>
        )}
      </div>
    </dialog>
  );
}
