"use client";

import { Check, Copy, ExternalLink, Link2, UserRoundCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { Affiliate } from "@/lib/dashboard/types";
import { moneyFormatter } from "@/lib/dashboard/formatters";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { StatusBadge } from "@/components/ui/status-badge";

export function AffiliatesView({ data }: { data: Affiliate[] }) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Affiliate | null>(null);
  const [copied, setCopied] = useState(false);

  const filtered = useMemo(() => {
    const term = search.toLocaleLowerCase("pt-BR");
    return data.filter((affiliate) => [affiliate.name, affiliate.email, affiliate.code]
      .some((value) => value.toLocaleLowerCase("pt-BR").includes(term)));
  }, [data, search]);

  async function copyLink(code: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/checkout/basico?ref=${code}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <>
      <section className="panel affiliates-panel">
        <div className="affiliate-toolbar">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar afiliado por nome, e-mail ou código" />
          <div className="mini-metric"><span><UserRoundCheck size={17} /></span><div><small>Afiliados ativos</small><strong>3</strong></div></div>
        </div>
        {filtered.length ? (
          <div className="affiliate-grid">
            {filtered.map((affiliate) => (
              <button key={affiliate.id} className="affiliate-card" onClick={() => setSelected(affiliate)}>
                <div className="affiliate-card-head">
                  <span className="avatar">{affiliate.name.split(" ").map((name) => name[0]).slice(0, 2).join("")}</span>
                  <div><strong>{affiliate.name}</strong><small>{affiliate.email}</small></div>
                  <StatusBadge status={affiliate.active ? "active" : "inactive"} />
                </div>
                <div className="affiliate-code"><Link2 size={15} /> /checkout/basico?ref={affiliate.code}</div>
                <div className="affiliate-stats">
                  <div><small>Vendas</small><strong>{affiliate.sales}</strong></div>
                  <div><small>Volume</small><strong>{moneyFormatter.format(affiliate.volume)}</strong></div>
                  <div><small>Disponível</small><strong>{moneyFormatter.format(affiliate.availableCommission)}</strong></div>
                </div>
                <span className="card-cta">Ver detalhes <ExternalLink size={14} /></span>
              </button>
            ))}
          </div>
        ) : <EmptyState title="Nenhum afiliado encontrado" description="Tente buscar por outro nome, e-mail ou código." />}
      </section>

      {selected && (
        <div className="drawer-layer">
          <button className="drawer-backdrop" onClick={() => setSelected(null)} aria-label="Fechar detalhes do afiliado" />
          <aside className="payment-drawer affiliate-drawer" role="dialog" aria-modal="true" aria-labelledby="affiliate-name">
            <header className="drawer-header">
              <div><span>Perfil do afiliado</span><h2 id="affiliate-name">{selected.name}</h2></div>
              <button className="icon-button" onClick={() => setSelected(null)} aria-label="Fechar"><X size={20} /></button>
            </header>
            <div className="drawer-content">
              <div className="affiliate-profile">
                <span className="avatar large">{selected.name.split(" ").map((name) => name[0]).slice(0, 2).join("")}</span>
                <div><StatusBadge status={selected.active ? "active" : "inactive"} /><p>Parceiro desde março de 2026</p></div>
              </div>
              <section className="drawer-section">
                <h3>Cadastro</h3>
                <dl className="detail-list">
                  <div><dt>E-mail</dt><dd>{selected.email}</dd></div>
                  <div><dt>Documento</dt><dd>{selected.document}</dd></div>
                  <div><dt>Chave PIX</dt><dd>{selected.pixKey}</dd></div>
                  <div><dt>Código</dt><dd>{selected.code}</dd></div>
                  <div><dt>Regra</dt><dd>{selected.commissionRule}</dd></div>
                </dl>
              </section>
              <section className="drawer-section">
                <h3>Link de indicação</h3>
                <button className="copy-link" onClick={() => copyLink(selected.code)}>
                  <span>/checkout/basico?ref={selected.code}</span>{copied ? <Check size={16} /> : <Copy size={16} />}
                </button>
              </section>
              <section className="drawer-section">
                <h3>Resultado financeiro</h3>
                <div className="affiliate-result-grid">
                  <div><small>Volume vendido</small><strong>{moneyFormatter.format(selected.volume)}</strong></div>
                  <div><small>Comissão pendente</small><strong>{moneyFormatter.format(selected.pendingCommission)}</strong></div>
                  <div><small>Disponível</small><strong>{moneyFormatter.format(selected.availableCommission)}</strong></div>
                  <div><small>Já paga</small><strong>{moneyFormatter.format(selected.paidCommission)}</strong></div>
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
      {copied && <div className="toast"><Check size={16} /> Link copiado com sucesso</div>}
    </>
  );
}
