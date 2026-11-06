"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, Building2, CalendarDays,
  CheckCircle2, CircleDollarSign, Download, Landmark, LockKeyhole,
  Pencil, Plus, ReceiptText, Search, Settings2, ShieldCheck, Trash2, Wallet, X,
} from "lucide-react";
import { formatCents } from "@/lib/operational";
import type { Bank, CashBox, Entry, MonthlySnapshot, Origin, Period } from "@/lib/accounting/calculations";
import styles from "./accounting-view.module.css";

type ViewData = MonthlySnapshot & {
  banks: Bank[]; boxes: CashBox[]; origins: Origin[]; period: Period | null;
};
type EntryDraft = {
  id?: string; kind: Entry["kind"]; title: string; amount: string;
  bankId: string; boxId: string; targetBankId: string; targetBoxId: string;
  originId: string; originName: string; status: Entry["status"];
  dueOn: string; settledOn: string; notes: string;
};
type SettingType = "bank" | "box" | "origin";
type SettingDraft = { type: SettingType; id?: string; name: string; personType: "pf" | "pj"; active: boolean };

const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());
const monthNow = () => today().slice(0, 7);
const shortDate = (value: string | null) => value
  ? new Date(value + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })
  : "—";
const money = (cents: number) => formatCents(cents);
const labelMonth = (month: string) => new Date(month + "-01T12:00:00Z")
  .toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const labelKind: Record<Entry["kind"], string> = {
  expense: "Conta / despesa", income: "Entrada", opening: "Saldo inicial / aporte", transfer: "Transferência",
};
function blankEntry(kind: Entry["kind"], month: string, view: ViewData): EntryDraft {
  const date = month === monthNow() ? today() : month + "-01";
  return {
    kind, title: kind === "opening" ? "Saldo inicial" : kind === "transfer" ? "Transferência entre caixas" : "",
    amount: "", bankId: view.banks.find((item) => item.active)?.id ?? "",
    boxId: view.boxes.find((item) => item.active)?.id ?? "",
    targetBankId: view.banks.find((item) => item.active)?.id ?? "",
    targetBoxId: view.boxes.find((item) => item.active)?.id ?? "",
    originId: "", originName: "", status: kind === "expense" ? "pending" : "paid", dueOn: date, settledOn: date, notes: "",
  };
}
function entryToDraft(entry: Entry): EntryDraft {
  return {
    id: entry.id, kind: entry.kind, title: entry.title,
    amount: String(entry.amount_cents / 100), bankId: entry.bank_id, boxId: entry.box_id,
    targetBankId: entry.target_bank_id ?? "", targetBoxId: entry.target_box_id ?? "",
    originId: entry.origin_id ?? "", originName: "", status: entry.status,
    dueOn: entry.due_on ?? today(), settledOn: entry.settled_on ?? today(), notes: entry.notes ?? "",
  };
}

export function AccountingView() {
  const [month, setMonth] = useState(monthNow);
  const [reload, setReload] = useState(0);
  const [view, setView] = useState<ViewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [entryModal, setEntryModal] = useState<EntryDraft | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setting, setSetting] = useState<SettingDraft | null>(null);
  const [bankFilter, setBankFilter] = useState("");
  const [boxFilter, setBoxFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [originFilter, setOriginFilter] = useState("");
  const [search, setSearch] = useState("");
  const titleListId = useId();

  useEffect(() => {
    let live = true;
    fetch("/api/contabilidade?mes=" + encodeURIComponent(month), { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw Error(data.error || "Falha ao consultar o financeiro.");
        if (live) { setView(data as ViewData); setError(""); }
      })
      .catch((cause) => { if (live) { setError(cause instanceof Error ? cause.message : "Falha ao carregar."); setView(null); } })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [month, reload]);

  async function mutate(method: "POST" | "PATCH" | "DELETE", payload: Record<string, unknown>, message: string) {
    setSaving(true); setError(""); setNotice("");
    try {
      const result = await fetch("/api/contabilidade", {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const response = await result.json();
      if (!result.ok) throw Error(response.error || "Não foi possível salvar.");
      setNotice(message); setEntryModal(null); setSetting(null);
      setReload((n) => n + 1);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar.");
      return false;
    } finally { setSaving(false); }
  }

  const closed = view?.period?.status === "closed";
  const canRecord = Boolean(view?.banks.some((item) => item.active) && view?.boxes.some((item) => item.active));

  function showEntry(kind: Entry["kind"]) {
    if (!view) return;
    if (!canRecord) { setSettingsOpen(true); return; }
    setError(""); setEntryModal(blankEntry(kind, month, view));
  }
  function chooseSuggestion(name: string, current: EntryDraft) {
    const suggestion = view?.suggestions.find((item) => item.title.trim().toLocaleLowerCase("pt-BR") === name.trim().toLocaleLowerCase("pt-BR"));
    setEntryModal(suggestion && !current.id ? {
      ...current, title: name, bankId: suggestion.bank_id, boxId: suggestion.box_id,
      originId: suggestion.origin_id ?? "",
    } : { ...current, title: name });
  }
  const selectedEntries = useMemo(() => {
    if (!view) return [];
    const text = search.trim().toLocaleLowerCase("pt-BR");
    return view.monthEntries.filter((entry) => {
      if (bankFilter && entry.bank_id !== bankFilter && entry.target_bank_id !== bankFilter) return false;
      if (boxFilter && entry.box_id !== boxFilter && entry.target_box_id !== boxFilter) return false;
      if (originFilter && entry.origin_id !== originFilter) return false;
      if (statusFilter === "pending" && entry.status !== "pending") return false;
      if (statusFilter === "paid" && entry.status !== "paid") return false;
      if (statusFilter === "expenses" && entry.kind !== "expense") return false;
      if (statusFilter === "transfers" && entry.kind !== "transfer") return false;
      if (text && ![entry.title, entry.notes ?? "", view.origins.find((x) => x.id === entry.origin_id)?.name ?? ""]
        .some((str) => str.toLocaleLowerCase("pt-BR").includes(text))) return false;
      return true;
    });
  }, [view, search, bankFilter, boxFilter, originFilter, statusFilter]);

  async function saveEntry(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!entryModal) return;
    const cents = Math.round(Number(entryModal.amount) * 100);
    if (!Number.isSafeInteger(cents) || cents <= 0) { setError("Informe um valor válido maior que zero."); return; }
    const dueOn = entryModal.kind === "expense" ? entryModal.dueOn : null;
    const expectedMonth = (entryModal.status === "pending" && entryModal.kind === "expense"
      ? entryModal.dueOn : entryModal.settledOn).slice(0, 7);
    const payload = {
      action: "entry", id: entryModal.id,
      kind: entryModal.kind, title: entryModal.title.trim(), amountCents: cents,
      bankId: entryModal.bankId, boxId: entryModal.boxId,
      targetBankId: entryModal.targetBankId, targetBoxId: entryModal.targetBoxId,
      originId: entryModal.originId === "__new" ? null : entryModal.originId || null,
      originName: entryModal.originId === "__new" ? entryModal.originName.trim() : null,
      status: entryModal.kind === "expense" ? entryModal.status : "paid",
      dueOn, settledOn: entryModal.status === "pending" && entryModal.kind === "expense" ? null : entryModal.settledOn,
      notes: entryModal.notes.trim(),
    };
    const moved = expectedMonth !== month;
    const successful = await mutate(entryModal.id ? "PATCH" : "POST", payload,
      moved ? "Lançamento salvo no mês " + labelMonth(expectedMonth) + ". Altere o filtro para visualizá-lo."
        : entryModal.id ? "Lançamento atualizado." : "Lançamento registrado.");
    if (successful) setEntryModal(null);
  }

  function exportCsv() {
    if (!view) return;
    const headers = ["Mês","Descrição","Tipo","Banco","Caixa","Origem","Valor (R$)","Situação","Vencimento","Pagamento","Observações"];
    const cells = (entry: Entry) => [
      month, entry.title, labelKind[entry.kind], view.banks.find((x) => x.id === entry.bank_id)?.name ?? "",
      view.boxes.find((x) => x.id === entry.box_id)?.name ?? "",
      view.origins.find((x) => x.id === entry.origin_id)?.name ?? "",
      (entry.amount_cents / 100).toFixed(2).replace(".", ","), entry.status === "paid" ? "Pago" : "Pendente",
      entry.due_on ?? "", entry.settled_on ?? "", entry.notes ?? "",
    ];
    const escapeCsv = (value: string) => {
      const safe = /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
      return '"' + safe.replaceAll('"', '""') + '"';
    };
    const csv = [headers, ...view.monthEntries.map(cells)].map((row) => row.map(escapeCsv).join(";")).join("\r\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "contabilidade-" + month + ".csv";
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
    URL.revokeObjectURL(url);
  }

  function startSetting(type: SettingType, record?: Bank | CashBox | Origin) {
    setError("");
    setSetting({ type, id: record?.id, name: record?.name ?? "",
      personType: record && "person_type" in record ? record.person_type : "pf",
      active: record && "active" in record ? record.active : true });
  }
  async function saveSetting(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!setting) return;
    await mutate(setting.id ? "PATCH" : "POST", {
      action: setting.type, id: setting.id, name: setting.name.trim(),
      personType: setting.personType, active: setting.active,
    }, "Cadastro atualizado.");
  }
  async function deleteEntry(id: string) {
    if (!confirm("Excluir este lançamento? O saldo será recalculado imediatamente. Esta ação não pode ser desfeita.")) return;
    await mutate("DELETE", { id }, "Lançamento excluído e saldos atualizados.");
  }
  async function toggleClose() {
    if (!view) return;
    if (!confirm(closed
      ? "Reabrir " + labelMonth(month) + " para permitir alterações?"
      : "Fechar " + labelMonth(month) + "? Os lançamentos ficarão bloqueados até a reabertura.")) return;
    await mutate("PATCH", { action: "period", month, status: closed ? "open" : "closed" },
      closed ? "Mês reaberto." : "Mês fechado e protegido.");
  }
  const findBank = (id: string | null) => view?.banks.find((b) => b.id === id)?.name ?? "—";
  const findBox = (id: string | null) => view?.boxes.find((b) => b.id === id)?.name ?? "—";
  const findOrigin = (id: string | null) => view?.origins.find((b) => b.id === id)?.name ?? "Sem origem";
  const availableBanks = view?.banks.filter((b) => b.active || b.id === entryModal?.bankId || b.id === entryModal?.targetBankId) ?? [];
  const availableBoxes = view?.boxes.filter((b) => b.active || b.id === entryModal?.boxId || b.id === entryModal?.targetBoxId) ?? [];

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>Gestão interna · financeiro</span>
        <h1>Contabilidade financeira</h1>
        <p>Um banco, vários caixas. Controle o saldo de cada pessoa e empresa sem misturar responsabilidades.</p>
      </div>
      <button type="button" className={styles.secondaryButton} onClick={() => setSettingsOpen(true)}>
        <Settings2 size={17} /> Bancos, caixas e origens
      </button>
    </header>

    <section className={styles.periodBar}>
      <div className={styles.periodTitle}>
        <span className={styles.periodIcon}><CalendarDays size={21}/></span>
        <div><span>Competência mensal</span><strong>{labelMonth(month)}</strong></div>
      </div>
      <div className={styles.periodActions}>
        <label className={styles.monthInput}><span>Mês</span><input aria-label="Selecionar mês" type="month" min="2020-01" max="2100-12" value={month}
          onChange={(e) => { setLoading(true); setMonth(e.target.value); setBankFilter(""); setBoxFilter(""); setOriginFilter(""); }} /></label>
        {view && <span className={closed ? styles.closedBadge : styles.openBadge}>
          {closed ? <LockKeyhole size={14}/> : <CheckCircle2 size={14}/>}
          {closed ? "Mês fechado" : "Mês aberto"}
        </span>}
        <button type="button" className={styles.outlineButton} disabled={loading || saving || !view}
          onClick={exportCsv}><Download size={16}/> Exportar</button>
        <button type="button" className={styles.outlineButton} disabled={loading || saving || !view} onClick={toggleClose}>
          {closed ? "Reabrir mês" : "Fechar mês"}</button>
      </div>
    </section>

    {notice && <div className={styles.notice} role="status"><CheckCircle2 size={18}/>{notice}<button aria-label="Dispensar" onClick={() => setNotice("")}><X size={16}/></button></div>}
    {error && <div className={styles.error} role="alert">{error}<button aria-label="Dispensar" onClick={() => setError("")}><X size={16}/></button></div>}
    {loading && !view ? <div className={styles.loading}>Carregando posições e movimentações…</div> : null}

    {view && <>
      {!canRecord && <div className={styles.setup}>
        <div><strong>Comece organizando os seus caixas</strong><p>Cadastre os bancos e os responsáveis ou use sua estrutura de exemplo (Inter, Mercado Pago, Sicredi; Leandro, CRM, Lucas, Sonia e Prosperity Pay). Nenhum saldo será criado automaticamente.</p></div>
        <div><button className={styles.secondaryButton} onClick={() => setSettingsOpen(true)}>Cadastrar manualmente</button>
        <button className={styles.primaryButton} disabled={saving} onClick={() => void mutate("POST", { action: "setup" }, "Bancos e caixas iniciais cadastrados.")}>Criar estrutura inicial</button></div>
      </div>}

      <section className={styles.totals}>
        {[
          { icon: Wallet, label: "Saldo consolidado", value: view.totals.balance, help: "Soma de todos os bancos até o fim do mês", kind: "main" },
          { icon: Landmark, label: "Saldo anterior", value: view.totals.initialBalance, help: "Transportado do mês anterior", kind: "neutral" },
          { icon: ArrowUpCircle, label: "Entradas no mês", value: view.totals.received + view.totals.opening, help: "Receitas e aportes efetivados", kind: "green" },
          { icon: ArrowDownCircle, label: "Despesas pagas", value: view.totals.paid, help: "Débitos efetivamente pagos", kind: "orange" },
          { icon: ReceiptText, label: "Contas a pagar", value: view.totals.pending, help: "Ainda não descontadas do saldo", kind: "purple" },
        ].map((card) => { const Icon = card.icon; return <article key={card.label} className={styles.statCard} data-kind={card.kind}>
          <div className={styles.statIcon}><Icon size={19}/></div><span>{card.label}</span>
          <strong className={card.value < 0 ? styles.negative : ""}>{money(card.value)}</strong><small>{card.help}</small>
        </article>; })}
      </section>

      <div className={styles.twoCols}>
        <section className={styles.panel}>
          <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Disponibilidade real</span><h2>Saldo por banco</h2>
            <p>Dinheiro consolidado em cada instituição, distribuído pelos caixas.</p></div>
            <button className={styles.iconButton} title="Novo banco" onClick={() => { setSettingsOpen(true); startSetting("bank"); }}><Plus size={18}/></button>
          </div>
          <div className={styles.bankGrid}>
          {view.banks.length ? view.banks.map((bank) => <article className={styles.bankCard} key={bank.id}>
            <div className={styles.bankTop}><span className={styles.bankIcon}><Landmark size={19}/></span><div><h3>{bank.name}</h3><small>{bank.active ? "Conta ativa" : "Arquivado"}</small></div>
              <button className={styles.miniEdit} title="Editar banco" onClick={() => {setSettingsOpen(true);startSetting("bank",bank);}}><Pencil size={14}/></button></div>
            <strong className={(view.bankBalances[bank.id] ?? 0) < 0 ? styles.negative : ""}>{money(view.bankBalances[bank.id] ?? 0)}</strong>
            <div className={styles.splits}>{view.boxes.map((box) => <div key={box.id}><span>{box.name}</span><b>{money(view.matrix[bank.id + ":" + box.id] ?? 0)}</b></div>)}</div>
          </article>) : <p className={styles.empty}>Nenhum banco cadastrado.</p>}
          </div>
        </section>
        <section className={styles.panel}>
          <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Distribuição interna</span><h2>Saldo por caixa</h2>
            <p>Os responsáveis mantêm seus próprios saldos mesmo usando o mesmo banco.</p></div>
            <button className={styles.iconButton} title="Novo caixa" onClick={() => {setSettingsOpen(true);startSetting("box");}}><Plus size={18}/></button>
          </div>
          <div className={styles.boxGrid}>
            {view.boxes.length ? view.boxes.map((box) => <article key={box.id} className={styles.boxCard}>
              <div className={styles.boxHead}><span className={styles.boxIcon}>{box.person_type === "pj" ? <Building2 size={19}/> : <Wallet size={19}/>}</span>
                <div><strong>{box.name}</strong><small>{box.person_type === "pj" ? "Pessoa jurídica" : "Pessoa física"}{!box.active ? " · Arquivado" : ""}</small></div>
                <button className={styles.miniEdit} title="Editar caixa" onClick={() => {setSettingsOpen(true);startSetting("box",box);}}><Pencil size={14}/></button>
              </div>
              <strong className={styles.boxAmount}>{money(view.boxBalances[box.id] ?? 0)}</strong>
              <div className={styles.boxSources}>{view.banks.map((bank) => <span key={bank.id}>{bank.name}<b>{money(view.matrix[bank.id + ":" + box.id] ?? 0)}</b></span>)}</div>
            </article>) : <p className={styles.empty}>Nenhum caixa cadastrado.</p>}
          </div>
        </section>
      </div>

      <section className={styles.panel} id="finance-origin-anchor">
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Controle de lançamentos</span>
          <h2>Contas e movimentações</h2><p>Registre gastos, entradas e transferências. Contas pendentes não reduzem o saldo até serem pagas.</p></div>
          <div className={styles.entryActions}>
            <button className={styles.outlineButton} disabled={closed || !canRecord} onClick={() => showEntry("opening")}><CircleDollarSign size={16}/> Saldo / aporte</button>
            <button className={styles.outlineButton} disabled={closed || !canRecord} onClick={() => showEntry("income")}><ArrowUpCircle size={16}/> Entrada</button>
            <button className={styles.outlineButton} disabled={closed || !canRecord} onClick={() => showEntry("transfer")}><ArrowLeftRight size={16}/> Transferência</button>
            <button className={styles.primaryButton} disabled={closed || !canRecord} onClick={() => showEntry("expense")}><Plus size={17}/> Nova conta</button>
          </div>
        </div>
        <div className={styles.filters}>
          <label className={styles.search}><Search size={17}/><input placeholder="Buscar conta ou descrição" value={search} onChange={(e) => setSearch(e.target.value)}/></label>
          <select aria-label="Filtrar por banco" value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}><option value="">Todos os bancos</option>{view.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select aria-label="Filtrar por caixa" value={boxFilter} onChange={(e) => setBoxFilter(e.target.value)}><option value="">Todos os caixas</option>{view.boxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select aria-label="Filtrar por origem" value={originFilter} onChange={(e) => setOriginFilter(e.target.value)}><option value="">Todas as origens</option>{view.origins.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select aria-label="Filtrar por situação" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Todas as movimentações</option><option value="pending">Pendentes</option><option value="paid">Efetivadas</option>
            <option value="expenses">Somente despesas</option><option value="transfers">Transferências</option>
          </select>
        </div>
        <div className={styles.tableWrap}><table className={styles.table}><thead><tr>
          <th>Conta / descrição</th><th>Origem</th><th>Banco</th><th>Caixa</th><th>Data</th><th>Situação</th><th>Valor</th><th>Ações</th>
        </tr></thead><tbody>
          {selectedEntries.map((entry) => <tr key={entry.id}><td><strong>{entry.title}</strong><small>{labelKind[entry.kind]}</small></td>
            <td>{findOrigin(entry.origin_id)}</td>
            <td><strong>{findBank(entry.bank_id)}</strong>{entry.kind === "transfer" && <small>→ {findBank(entry.target_bank_id)}</small>}</td>
            <td><strong>{findBox(entry.box_id)}</strong>{entry.kind === "transfer" && <small>→ {findBox(entry.target_box_id)}</small>}</td>
            <td>{shortDate(entry.status === "paid" ? entry.settled_on : entry.due_on)}
              {entry.kind === "expense" && entry.status === "paid" && entry.due_on !== entry.settled_on && <small>Vence {shortDate(entry.due_on)}</small>}</td>
            <td><span className={entry.status === "pending" ? styles.pendingBadge : styles.paidBadge}>{entry.status === "pending" ? "Pendente" : "Efetivado"}</span></td>
            <td className={entry.kind === "expense" ? styles.expense : entry.kind === "income" || entry.kind === "opening" ? styles.income : styles.transfer}>
              {entry.kind === "expense" ? "−" : entry.kind === "transfer" ? "↔" : "+"}{money(entry.amount_cents)}</td>
            <td><div className={styles.rowActions}>
              {entry.status === "pending" && !closed && <button type="button" className={styles.payAction}
                onClick={() => setEntryModal({ ...entryToDraft(entry), status: "paid", settledOn: today() })}>Pagar</button>}
              {!closed && <><button type="button" title="Editar lançamento" onClick={() => setEntryModal(entryToDraft(entry))}><Pencil size={15}/></button>
                <button type="button" title="Excluir lançamento" onClick={() => void deleteEntry(entry.id)}><Trash2 size={15}/></button></>}
              {closed && <LockKeyhole size={16} className={styles.lock}/>}
            </div></td>
          </tr>)}
        </tbody></table>
        {!selectedEntries.length && <div className={styles.emptyTable}><ReceiptText size={27}/><strong>Nenhum lançamento neste período</strong><p>Altere os filtros ou adicione uma conta, entrada ou transferência.</p></div>}
        </div>
        <footer className={styles.tableFooter}><span>{selectedEntries.length} lançamentos exibidos</span>
          <span>Contas pendentes são apenas uma previsão e não abatem o saldo disponível.</span></footer>
      </section>

      {view.origins.length > 0 && <section className={styles.originPanel}>
        <div><span className={styles.eyebrow}>Classificação mensal</span><h2>Gastos por origem</h2><p>Identifique o que cada origem consumiu no mês.</p></div>
        <div className={styles.originList}>{view.origins.map((origin) => <button key={origin.id}
          className={originFilter === origin.id ? styles.originActive : styles.originItem}
          onClick={() => {setOriginFilter(originFilter === origin.id ? "" : origin.id); document.getElementById("finance-origin-anchor")?.scrollIntoView({behavior:"smooth"});}}>
          <span>{origin.name}</span><strong>{money(view.originExpenses[origin.id] ?? 0)}</strong>
        </button>)}</div>
      </section>}
      <p className={styles.disclaimer}><ShieldCheck size={16}/> Controle interno e manual, separado das vendas e comissões da plataforma. Transferências entre caixas do mesmo banco não alteram o saldo total do banco.</p>
    </>}

    {settingsOpen && view && <div className={styles.overlay} role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) {setSettingsOpen(false); setSetting(null);} }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div className={styles.dialogHead}><div><span className={styles.eyebrow}>Estrutura financeira</span><h2 id="settings-title">Bancos, caixas e origens</h2><p>Cadastre e organize os responsáveis e as classificações.</p></div>
          <button type="button" className={styles.iconButton} aria-label="Fechar" onClick={() => {setSettingsOpen(false);setSetting(null);}}><X size={20}/></button></div>
        <div className={styles.settingsGrid}>
          {([
            { type: "bank" as const, name: "Bancos", items: view.banks },
            { type: "box" as const, name: "Caixas", items: view.boxes },
            { type: "origin" as const, name: "Origens", items: view.origins },
          ]).map((group) => <div className={styles.settingsGroup} key={group.type}>
            <div className={styles.settingsTitle}><h3>{group.name}</h3><button type="button" onClick={() => startSetting(group.type)}><Plus size={15}/> Novo</button></div>
            <div className={styles.settingsList}>{group.items.length ? group.items.map((item) => <button type="button" key={item.id}
              onClick={() => startSetting(group.type, item)}><span>{item.name}</span>
              {"person_type" in item && <small>{item.person_type === "pf" ? "PF" : "PJ"}</small>}
              {"active" in item && !item.active && <small>Inativo</small>}<Pencil size={14}/></button>)
              : <span className={styles.empty}>Nenhum cadastro.</span>}</div>
          </div>)}
        </div>
        {setting && <form className={styles.settingForm} onSubmit={(e) => void saveSetting(e)}>
          <h3>{setting.id ? "Editar" : "Cadastrar"} {setting.type === "bank" ? "banco" : setting.type === "box" ? "caixa" : "origem"}</h3>
          <label>Nome<input autoFocus required minLength={2} maxLength={100} value={setting.name} onChange={(e) => setSetting({...setting,name:e.target.value})}/></label>
          {setting.type === "box" && <label>Perfil do caixa<select value={setting.personType} onChange={(e) => setSetting({...setting,personType:e.target.value as "pf"|"pj"})}><option value="pf">Pessoa física</option><option value="pj">Pessoa jurídica / empresa</option></select></label>}
          {setting.id && setting.type !== "origin" && <label className={styles.switchRow}><input type="checkbox" checked={setting.active} onChange={(e) => setSetting({...setting,active:e.target.checked})}/> Cadastro ativo</label>}
          <div className={styles.formActions}><button type="button" className={styles.outlineButton} onClick={() => setSetting(null)}>Cancelar</button>
            <button className={styles.primaryButton} type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar cadastro"}</button></div>
        </form>}
        {error && <div className={styles.formError} role="alert">{error}</div>}
      </section></div>}

    {entryModal && view && <div className={styles.overlay} role="presentation" onMouseDown={(e) => {if (e.target === e.currentTarget && !saving) setEntryModal(null);}}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="entry-title">
        <div className={styles.dialogHead}><div><span className={styles.eyebrow}>Lançamento financeiro</span>
          <h2 id="entry-title">{entryModal.id ? "Editar lançamento" : labelKind[entryModal.kind]}</h2>
          <p>Identifique o banco físico e o caixa responsável.</p></div>
          <button type="button" className={styles.iconButton} aria-label="Fechar" onClick={() => setEntryModal(null)}><X size={20}/></button></div>
        <form className={styles.entryForm} onSubmit={(e) => void saveEntry(e)}>
          <div className={styles.formGrid}>
            <label className={styles.full}>Descrição / nome da conta<input autoFocus required minLength={2} maxLength={160}
              list={entryModal.kind === "expense" ? titleListId : undefined}
              placeholder={entryModal.kind === "expense" ? "Ex.: Vercel, Mercado Livre, Linkspeed" : "Informe a descrição"}
              value={entryModal.title} onChange={(e) => chooseSuggestion(e.target.value, entryModal)}/></label>
            <datalist id={titleListId}>{view.suggestions.map((item) => <option value={item.title} key={item.title}/>)}</datalist>
            <label>Valor (R$)<input required min="0.01" step="0.01" type="number" inputMode="decimal" value={entryModal.amount}
              onChange={(e) => setEntryModal({...entryModal,amount:e.target.value})} placeholder="0,00"/></label>
            <label>Banco de {entryModal.kind === "transfer" ? "origem" : "pagamento"}<select required value={entryModal.bankId} onChange={(e) => setEntryModal({...entryModal,bankId:e.target.value})}>
              <option value="">Selecione o banco</option>{availableBanks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            <label>Caixa responsável<select required value={entryModal.boxId} onChange={(e) => setEntryModal({...entryModal,boxId:e.target.value})}>
              <option value="">Selecione o caixa</option>{availableBoxes.map((b) => <option key={b.id} value={b.id}>{b.name} · {b.person_type.toUpperCase()}</option>)}</select></label>

            {entryModal.kind === "transfer" && <>
              <label>Banco de destino<select required value={entryModal.targetBankId} onChange={(e) => setEntryModal({...entryModal,targetBankId:e.target.value})}>
                <option value="">Selecione o banco</option>{availableBanks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
              <label>Caixa de destino<select required value={entryModal.targetBoxId} onChange={(e) => setEntryModal({...entryModal,targetBoxId:e.target.value})}>
                <option value="">Selecione o caixa</option>{availableBoxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
            </>}

            {entryModal.kind !== "transfer" && <label>Origem / categoria<select value={entryModal.originId}
              onChange={(e) => setEntryModal({...entryModal,originId:e.target.value})}>
              <option value="">Sem origem</option>{view.origins.map((origin) => <option key={origin.id} value={origin.id}>{origin.name}</option>)}
              <option value="__new">+ Criar nova origem</option></select></label>}
            {entryModal.originId === "__new" && entryModal.kind !== "transfer" && <label>Nome da nova origem<input required minLength={2} maxLength={100}
              placeholder="Ex.: Cartão Inter, Internet..." value={entryModal.originName}
              onChange={(e) => setEntryModal({...entryModal,originName:e.target.value})}/></label>}
            {entryModal.kind === "expense" && <label>Situação<select value={entryModal.status}
              onChange={(e) => setEntryModal({...entryModal,status:e.target.value as Entry["status"]})}>
              <option value="pending">Pendente (não reduz o saldo)</option><option value="paid">Pago (reduz o saldo)</option></select></label>}
            {entryModal.kind === "expense" && <label>Vencimento<input required type="date" value={entryModal.dueOn}
              onChange={(e) => setEntryModal({...entryModal,dueOn:e.target.value})}/></label>}
            {(entryModal.kind !== "expense" || entryModal.status === "paid") && <label>Data {entryModal.kind === "expense" ? "do pagamento" : "da movimentação"}
              <input required type="date" value={entryModal.settledOn} onChange={(e) => setEntryModal({...entryModal,settledOn:e.target.value})}/></label>}
            <label className={styles.full}>Observações (opcional)<textarea rows={2} maxLength={1000} value={entryModal.notes}
              onChange={(e) => setEntryModal({...entryModal,notes:e.target.value})} placeholder="Detalhes deste lançamento"/></label>
          </div>
          {entryModal.kind === "expense" && <div className={styles.formInfo}>Ao marcar como pago, o valor será abatido somente do caixa <strong>{findBox(entryModal.boxId)}</strong> dentro do banco <strong>{findBank(entryModal.bankId)}</strong>. O mês contábil segue a data do pagamento; para contas pendentes, segue o vencimento.</div>}
          {entryModal.kind === "transfer" && <div className={styles.formInfo}>A transferência debita o caixa de origem e credita o destino em uma única operação. Se o banco for o mesmo, o saldo consolidado dele não muda.</div>}
          {error && <div className={styles.formError} role="alert">{error}</div>}
          <div className={styles.formActions}><button type="button" className={styles.outlineButton} onClick={() => setEntryModal(null)}>Cancelar</button>
            <button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? "Salvando..." : entryModal.id ? "Salvar alterações" : "Registrar lançamento"}</button></div>
        </form>
      </section></div>}
  </div>;
}
