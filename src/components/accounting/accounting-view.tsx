"use client";

import { useEffect, useId, useMemo, useState } from "react";
import {
  ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, Building2, CalendarDays,
  CheckCircle2, CircleDollarSign, Download, Landmark, LockKeyhole,
  Pencil, Plus, ReceiptText, Search, Settings2, ShieldCheck, Trash2, Wallet, X, Save, Loader2,
} from "lucide-react";
import { formatCents } from "@/lib/operational";
import { shiftMonthlyDate } from "@/lib/accounting/installments";
import { CashFlowPanel } from "./cash-flow-panel";
import { QuickInputCell, QuickSelectCell } from "./quick-edit-cell";
import type { PlannerView } from "./cash-flow-panel";
import { invoiceDueDate, brazilDate } from "@/lib/accounting/cash-flow";
import type { Bank, CashBox, Entry, MonthlySnapshot, Origin, Period } from "@/lib/accounting/calculations";
import styles from "./accounting-view.module.css";

type ViewData = MonthlySnapshot & PlannerView & {
  origins: Origin[]; period: Period | null;
};
type EntryDraft = {
  id?: string; kind: Entry["kind"]; title: string; amount: string; cardId: string;
  bankId: string; boxId: string; targetBankId: string; targetBoxId: string;
  originId: string; originName: string; status: Entry["status"];
  dueOn: string; settledOn: string; movementAt: string; notes: string;
  installmentNumber: number; installmentTotal: number;
};
type SettingType = "bank" | "box" | "origin";
type SettingDraft = { type: SettingType; id?: string; name: string; personType: "pf" | "pj"; active: boolean };

const today = () => localDateTime(new Date()).slice(0, 10);
const monthNow = () => today().slice(0, 7);
function localDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {timeZone:"America/Sao_Paulo",
    year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const get = (key: string) => parts.find((part) => part.type === key)?.value ?? "";
  return get("year") + "-" + get("month") + "-" + get("day") + "T" + get("hour") + ":" + get("minute");
}
const shortDate = (value: string | null) => value
  ? new Date(value + "T12:00:00Z").toLocaleDateString("pt-BR", { timeZone: "UTC" })
  : "—";
const money = (cents: number) => formatCents(cents);
const labelMonth = (month: string) => new Date(month + "-01T12:00:00Z")
  .toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const labelKind: Record<Entry["kind"], string> = {
  expense: "Conta / despesa", income: "Entrada", opening: "Saldo inicial / aporte", transfer: "Transferência", outflow: "Saída bancária / Pix",
};
function blankEntry(kind: Entry["kind"], month: string, view: ViewData): EntryDraft {
  const date = month === monthNow() ? today() : month + "-01";
  return {
    kind, title: kind === "opening" ? "Saldo inicial" : kind === "transfer" ? "Transferência entre caixas" : kind === "outflow" ? "Pix enviado" : "",
    amount: "", cardId:"", bankId: view.banks.find((item) => item.active)?.id ?? "",
    boxId: view.boxes.find((item) => item.active)?.id ?? "",
    targetBankId: view.banks.find((item) => item.active)?.id ?? "",
    targetBoxId: view.boxes.find((item) => item.active)?.id ?? "",
    originId: "", originName: "", status: kind === "expense" ? "pending" : "paid", dueOn: date,
    settledOn: kind === "opening" ? "" : date, movementAt: "", notes: "",
    installmentNumber: 1, installmentTotal: 1,
  };
}
function entryToDraft(entry: Entry): EntryDraft {
  return {
    id: entry.id, kind: entry.kind, title: entry.title, cardId:entry.card_id??"",
    amount: String(entry.amount_cents / 100), bankId: entry.bank_id, boxId: entry.box_id,
    targetBankId: entry.target_bank_id ?? "", targetBoxId: entry.target_box_id ?? "",
    originId: entry.origin_id ?? "", originName: "", status: entry.status,
    dueOn: entry.due_on ?? today(), settledOn: entry.settled_on ?? today(),
    movementAt: entry.movement_at ? localDateTime(new Date(entry.movement_at)) : "", notes: entry.notes ?? "",
    installmentNumber: entry.installment_number ?? 1, installmentTotal: entry.installment_total ?? 1,
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
  const [sheetTab, setSheetTab] = useState<"forecast" | "accounts" | "cards" | "balances" | "other">("forecast");
  const [quickEditing, setQuickEditing] = useState(false);
  const [quickSaving, setQuickSaving] = useState<string | null>(null);
  const [quickSaved, setQuickSaved] = useState<string | null>(null);
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

  function showEntry(kind: Entry["kind"], bankId?: string, boxId?: string) {
    if (!view) return;
    if (!canRecord) { setSettingsOpen(true); return; }
    setError(""); setEntryModal({...blankEntry(kind, month, view), ...(bankId ? {bankId} : {}), ...(boxId ? {boxId} : {})});
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
    if(entryModal.cardId&&entryModal.status==="paid") {
      setError("Compra no cartão não é pagamento bancário. Vá à aba Faturas para registrar a quitação.");
      return;
    }
    if (entryModal.kind === "expense" && (entryModal.installmentNumber > entryModal.installmentTotal || entryModal.installmentTotal > 120)) {
      setError("A parcela atual deve ser menor ou igual ao total, limitado a 120.");
      return;
    }
    const moment = entryModal.movementAt.trim();
    const expectedMonth = (entryModal.kind === "expense" && entryModal.status === "pending"
      ? entryModal.dueOn : moment ? moment.slice(0, 10) : entryModal.settledOn || today()).slice(0, 7);
    const payload = {
      action: "entry", id: entryModal.id,
      kind: entryModal.kind, title: entryModal.title.trim(), amountCents: cents,
      cardId: entryModal.kind==="expense" ? entryModal.cardId||null : null,
      bankId: entryModal.bankId, boxId: entryModal.boxId,
      targetBankId: entryModal.targetBankId, targetBoxId: entryModal.targetBoxId,
      originId: entryModal.originId === "__new" ? null : entryModal.originId || null,
      originName: entryModal.originId === "__new" ? entryModal.originName.trim() : null,
      status: entryModal.kind === "expense" ? entryModal.status : "paid",
      dueOn, settledOn: entryModal.status === "pending" && entryModal.kind === "expense" ? null : entryModal.settledOn || null,
      movementAt: entryModal.status === "pending" && entryModal.kind === "expense" ? null : moment || null,
      installmentNumber: entryModal.id ? undefined : entryModal.installmentNumber,
      installmentTotal: entryModal.id ? undefined : entryModal.installmentTotal,
      notes: entryModal.notes.trim(),
    };
    const moved = expectedMonth !== month;
    const successful = await mutate(entryModal.id ? "PATCH" : "POST", payload,
      moved ? "Lançamento salvo no mês " + labelMonth(expectedMonth) + ". Altere o filtro para visualizá-lo."
        : entryModal.id ? "Lançamento atualizado." : entryModal.kind === "expense" && entryModal.installmentTotal > 1
          ? "Parcela " + entryModal.installmentNumber + "/" + entryModal.installmentTotal + " registrada. As parcelas restantes foram geradas nos próximos meses."
          : "Lançamento registrado.");
    if (successful) setEntryModal(null);
  }

  async function quickSave(entry: Entry, field: string, raw: string): Promise<boolean> {
    if (closed || quickSaving) return false;
    let value: string | number = raw;
    if (field === "amountCents") {
      const normalized = raw.trim().replace(",", ".");
      if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
        setError("Informe um valor em reais com até duas casas decimais.");
        return false;
      }
      value = Math.round(Number(normalized) * 100);
      if (!Number.isSafeInteger(value) || value <= 0) {
        setError("O valor da conta precisa ser maior que zero."); return false;
      }
    }
    if (field === "title" && raw.trim().length < 2) {
      setError("A descrição precisa ter pelo menos dois caracteres."); return false;
    }
    if (field === "status") {
      if (!confirm(raw === "paid"
        ? "Confirmar que esta conta foi paga agora? O saldo será reduzido e a data do pagamento será hoje."
        : "Reverter esta conta para pendente? O valor voltará ao saldo e o pagamento será desfeito.")) return false;
    }
    setQuickSaving(entry.id); setQuickSaved(null); setError(""); setNotice("");
    try {
      const response = await fetch("/api/contabilidade", {
        method:"PATCH",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"quick_entry",id:entry.id,updatedAt:entry.updated_at,field,value}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível salvar a alteração.");
      const record = result.record as Entry;
      setView(current=>current?{
        ...current,monthEntries:current.monthEntries.map(item=>item.id===entry.id?record:item),
      }:current);
      setQuickSaved(entry.id);
      setReload(n=>n+1);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível alterar a conta.");
      return false;
    } finally {
      setQuickSaving(null);
    }
  }

  function exportCsv() {
    if (!view) return;
    const headers = ["Mês","Descrição","Tipo","Banco","Cartão","Caixa","Origem","Parcela","Valor (R$)","Situação","Vencimento","Pagamento","Data e hora","Observações"];
    const cells = (entry: Entry) => [
      month, entry.title, labelKind[entry.kind], view.banks.find((x) => x.id === entry.bank_id)?.name ?? "",
      view.cards.find(c=>c.id===entry.card_id)?.name??"",
      view.boxes.find((x) => x.id === entry.box_id)?.name ?? "",
      view.origins.find((x) => x.id === entry.origin_id)?.name ?? "",
      entry.installment_total ? entry.installment_number + "/" + entry.installment_total : "",
      (entry.amount_cents / 100).toFixed(2).replace(".", ","), entry.card_id?"Na fatura":entry.status==="paid"?"Pago":"Pendente",
      entry.due_on ?? "", entry.settled_on ?? "", entry.movement_at ?? "", entry.notes ?? "",
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
    await mutate("DELETE", { action: "entry", id }, "Lançamento excluído e saldos atualizados.");
  }
  async function deleteSetting() {
    if (!setting?.id || setting.type === "origin") return;
    if (!confirm("Apagar " + setting.name + " definitivamente?\nEsta ação só será permitida quando não houver contas, saldos ou transferências vinculadas a este cadastro.")) return;
    await mutate("DELETE", { action: setting.type, id: setting.id },
      (setting.type === "bank" ? "Banco" : "Caixa") + " apagado com sucesso.");
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
  const visibleRows = selectedEntries.filter((entry) => sheetTab === "accounts" ? entry.kind === "expense" : entry.kind !== "expense")
    .sort((a,b) => sheetTab === "accounts"
      ? (a.due_on ?? "").localeCompare(b.due_on ?? "") || a.title.localeCompare(b.title, "pt-BR")
      : b.created_at.localeCompare(a.created_at));
  const sheetTotal = visibleRows.reduce((total, row) => total + row.amount_cents, 0);
  const sheetPending = visibleRows.filter(row=>row.status==="pending"&&!row.card_id).reduce((total,row)=>total+row.amount_cents,0);
  const quickEnabled = quickEditing && sheetTab === "accounts" && !closed;
  const quickBusy = quickSaving !== null;
  const sheetInvoices = view?.invoices.filter(i=>i.invoice_month===month+"-01")
    .reduce((sum,i)=>sum+i.remaining_cents,0)??0;

  return <div className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>Gestão interna · financeiro</span>
        <h1>Contabilidade financeira</h1>
        <p>Um banco, vários caixas. Separe contas a pagar das entradas, transferências e saídas bancárias avulsas.</p>
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
          { icon: Wallet, label: "Saldo consolidado", value: view.totals.balance, help: "Dinheiro contabilizado até o mês selecionado", kind: "main" },
          { icon: Landmark, label: "Saldo anterior", value: view.totals.initialBalance, help: "Transportado do mês anterior", kind: "neutral" },
          { icon: ArrowUpCircle, label: "Entradas no mês", value: view.totals.received + view.totals.opening, help: "Receitas e aportes efetivados", kind: "green" },
          { icon: ArrowDownCircle, label: "Despesas pagas", value: view.totals.paid, help: "Contas e faturas pagas", kind: "orange" },
          { icon: ArrowLeftRight, label: "Saídas avulsas", value: view.totals.outflow, help: "Pix e débitos sem conta a pagar", kind: "neutral" },
          { icon: ReceiptText, label: "Contas a pagar", value: view.totals.pending, help: "Inclui faturas líquidas em aberto neste mês", kind: "purple" },
        ].map((card) => { const Icon = card.icon; return <article key={card.label} className={styles.statCard} data-kind={card.kind}>
          <div className={styles.statIcon}><Icon size={19}/></div><span>{card.label}</span>
          <strong className={card.value < 0 ? styles.negative : ""}>{money(card.value)}</strong><small>{card.help}</small>
        </article>; })}
      </section>

      <nav className={styles.sheetTabs} aria-label="Áreas da contabilidade">
        <button type="button" className={sheetTab==="forecast"?styles.activeTab:styles.tab}
          onClick={()=>setSheetTab("forecast")}><CalendarDays size={17}/> Fluxo de caixa</button>
        <button type="button" className={sheetTab === "accounts" ? styles.activeTab : styles.tab}
          aria-current={sheetTab === "accounts" ? "page" : undefined} onClick={() => setSheetTab("accounts")}><ReceiptText size={17}/> Planilha de contas</button>
        <button type="button" className={sheetTab==="cards"?styles.activeTab:styles.tab}
          onClick={()=>setSheetTab("cards")}><ReceiptText size={17}/> Faturas de cartões</button>
        <button type="button" className={sheetTab === "balances" ? styles.activeTab : styles.tab}
          aria-current={sheetTab === "balances" ? "page" : undefined} onClick={() => setSheetTab("balances")}><Wallet size={17}/> Saldos por banco e caixa</button>
        <button type="button" className={sheetTab === "other" ? styles.activeTab : styles.tab}
          aria-current={sheetTab === "other" ? "page" : undefined} onClick={() => setSheetTab("other")}><ArrowLeftRight size={17}/> Entradas e transferências</button>
      </nav>
      {(sheetTab==="forecast"||sheetTab==="cards")&&<CashFlowPanel
        view={view} mode={sheetTab} closed={Boolean(closed)}
        onChanged={()=>setReload(x=>x+1)}/>}
      {sheetTab === "balances" && <section className={styles.panel}>
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Planilha de saldos · {labelMonth(month)}</span>
          <h2>Distribuição do dinheiro</h2><p>Clique em uma célula para registrar saldo inicial ou aporte neste banco e caixa. Os valores exibidos são acumulados até o mês selecionado.</p></div>
          <button className={styles.primaryButton} disabled={closed || !canRecord} onClick={() => showEntry("opening")}><Plus size={16}/> Registrar saldo / aporte</button>
        </div>
        <div className={styles.sheetTableWrap}><table className={styles.balanceMatrix}>
          <thead><tr><th>Banco / Caixa</th>{view.boxes.map((box) => <th key={box.id}>{box.name}<small>{box.person_type.toUpperCase()}</small></th>)}<th>Total do banco</th></tr></thead>
          <tbody>{view.banks.filter(bank=>bank.active).map((bank) => <tr key={bank.id}><th scope="row"><Landmark size={15}/> {bank.name}</th>
            {view.boxes.map((box) => <td key={box.id}><button type="button" title={"Adicionar saldo no banco " + bank.name + ", caixa " + box.name}
              disabled={closed || !bank.active || !box.active}
              onClick={() => showEntry("opening", bank.id, box.id)}>{money(view.matrix[bank.id + ":" + box.id] ?? 0)} <Plus size={13}/></button></td>)}
            <td className={styles.matrixTotal}>{money(view.bankBalances[bank.id] ?? 0)}</td></tr>)}</tbody>
          <tfoot><tr><th>Total por caixa</th>{view.boxes.map((box) => <td key={box.id}>{money(view.boxBalances[box.id] ?? 0)}</td>)}
            <td>{money(view.totals.balance)}</td></tr></tfoot>
        </table></div>
        <p className={styles.balanceNote}>Saldo / aporte <strong>soma</strong> ao saldo existente; não o substitui. O saldo de um mês passa automaticamente para o seguinte.</p>
      </section>}
{sheetTab === "balances" && <>      <div className={styles.twoCols}>
        <section className={styles.panel}>
          <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Disponibilidade real</span><h2>Saldo por banco</h2>
            <p>Dinheiro consolidado em cada instituição, distribuído pelos caixas.</p></div>
            <button className={styles.iconButton} title="Novo banco" onClick={() => { setSettingsOpen(true); startSetting("bank"); }}><Plus size={18}/></button>
          </div>
          <div className={styles.bankGrid}>
          {view.banks.some(b=>b.active) ? view.banks.filter(b=>b.active).map((bank) => <article className={styles.bankCard} key={bank.id}>
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
              <div className={styles.boxSources}>{view.banks.filter(bank=>bank.active).map((bank) => <span key={bank.id}>{bank.name}<b>{money(view.matrix[bank.id + ":" + box.id] ?? 0)}</b></span>)}</div>
            </article>) : <p className={styles.empty}>Nenhum caixa cadastrado.</p>}
          </div>
        </section>
      </div>

</>}
      {(sheetTab==="accounts"||sheetTab==="other") && <>      <section className={styles.panel} id="finance-origin-anchor">
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Planilha mensal · {labelMonth(month)}</span>
          <h2>{sheetTab === "accounts" ? "Contas do mês" : "Movimentações bancárias"}</h2>
          <p>{sheetTab === "accounts"
            ? "Registre as contas de uma vez, no início ou no fim do mês. Cada parcela futura aparece automaticamente na sua competência."
            : "Pix enviados, saídas avulsas, aportes, entradas e transferências do mês; sem misturar com contas pendentes."}</p></div>
          <div className={styles.entryActions}>
            {sheetTab === "accounts" ? <>
              <button type="button" className={quickEditing ? styles.editModeActive : styles.outlineButton}
                disabled={closed || quickBusy} aria-pressed={quickEditing}
                onClick={() => {setQuickEditing(v=>!v);setQuickSaved(null);}}>
                <Pencil size={16}/> {quickEditing ? "Concluir edição" : "Habilitar edição"}
              </button>
              <button className={styles.primaryButton} disabled={closed || !canRecord || quickBusy} onClick={() => showEntry("expense")}><Plus size={17}/> Adicionar conta</button>
            </> : <>
              <button className={styles.outlineButton} disabled={closed || !canRecord} onClick={() => showEntry("opening")}><CircleDollarSign size={16}/> Saldo / aporte</button>
              <button className={styles.outlineButton} disabled={closed || !canRecord} onClick={() => showEntry("income")}><ArrowUpCircle size={16}/> Entrada</button>
              <button className={styles.outlineButton} disabled={closed || !canRecord} onClick={() => showEntry("transfer")}><ArrowLeftRight size={16}/> Transferência</button>
              <button className={styles.outlineButton} disabled={closed || !canRecord} onClick={() => showEntry("outflow")}><ArrowDownCircle size={16}/> Saída / Pix</button>
            </>}
          </div>
        </div>
        {sheetTab === "accounts" && quickEnabled && <div className={styles.quickHelp}>
          <Save size={16}/> Edição rápida habilitada. Selecione uma opção para salvar; textos, valores e datas
          são salvos ao sair do campo ou pressionar Enter. Cada parcela é independente.
          {quickBusy && <span><Loader2 size={15} className={styles.quickSpin}/> Salvando…</span>}
        </div>}
        {sheetTab === "accounts" && <div className={styles.sheetMetrics}>
          <div><span>Contas na planilha</span><strong>{visibleRows.length}</strong></div>
          <div><span>Valor previsto</span><strong>{money(sheetTotal)}</strong></div>
          <div><span>Contas diretas pendentes</span><strong>{money(sheetPending)}</strong></div>
          <div><span>Faturas líquidas em aberto</span><strong>{money(sheetInvoices)}</strong></div>
        </div>}
        <div className={styles.filters}>
          <label className={styles.search}><Search size={17}/><input placeholder="Buscar conta ou descrição" value={search} onChange={(e) => setSearch(e.target.value)}/></label>
          <select aria-label="Filtrar por banco" value={bankFilter} onChange={(e) => setBankFilter(e.target.value)}><option value="">Todos os bancos</option>{view.banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select aria-label="Filtrar por caixa" value={boxFilter} onChange={(e) => setBoxFilter(e.target.value)}><option value="">Todos os caixas</option>{view.boxes.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select aria-label="Filtrar por origem" value={originFilter} onChange={(e) => setOriginFilter(e.target.value)}><option value="">Todas as origens</option>{view.origins.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <select aria-label="Filtrar por situação" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Todas as movimentações</option><option value="pending">Pendentes</option><option value="paid">Efetivadas</option>
            
          </select>
        </div>
        <div className={styles.sheetTableWrap}><table className={styles.table}><thead><tr>
          <th>Conta / descrição</th><th>Origem</th><th>Parcela</th><th>Banco / Cartão</th><th>Caixa</th><th>Data</th><th>Situação</th><th>Valor</th><th>Ações</th>
        </tr></thead><tbody>
          {visibleRows.map((entry) => <tr key={entry.id} className={quickEnabled ? styles.quickRow : undefined}>
            <td>{quickEnabled ? <QuickInputCell label={"Descrição de "+entry.title} value={entry.title}
              disabled={quickBusy} saving={quickSaving===entry.id}
              onCommit={value=>quickSave(entry,"title",value)}/> : <strong>{entry.title}</strong>}
              <small>{labelKind[entry.kind]}</small></td>
            <td>{quickEnabled ? <QuickSelectCell label={"Origem de "+entry.title} value={entry.origin_id??""}
              disabled={quickBusy} saving={quickSaving===entry.id}
              onCommit={value=>quickSave(entry,"originId",value)}
              onCreate={()=>{setSettingsOpen(true);startSetting("origin");}}
              options={[{value:"",label:"Sem origem"},
                ...view.origins.map(o=>({value:o.id,label:o.name})),
                {value:"__new__",label:"+ Nova origem"}]}/> : findOrigin(entry.origin_id)}</td>
            <td>{entry.installment_total ? <span className={styles.installmentBadge}>{entry.installment_number}/{entry.installment_total}</span> : <span className={styles.noInstallment}>—</span>}</td>
            <td>{quickEnabled ? <QuickSelectCell label={"Banco ou cartão de "+entry.title}
              value={entry.card_id ? "card:"+entry.card_id : "bank:"+entry.bank_id}
              disabled={quickBusy} saving={quickSaving===entry.id}
              onCommit={value=>quickSave(entry,"paymentSource",value)}
              options={[
                ...view.banks.filter(b=>b.active||(!entry.card_id&&b.id===entry.bank_id))
                  .map(b=>({value:"bank:"+b.id,label:"Banco · "+b.name})),
                ...view.cards.filter(c=>(c.active||c.id===entry.card_id)&&entry.status!=="paid")
                  .map(c=>({value:"card:"+c.id,label:c.name})),
              ]}/> : <><strong>{entry.card_id?view.cards.find(c=>c.id===entry.card_id)?.name??"Cartão":findBank(entry.bank_id)}</strong>
                {entry.card_id&&<small>Fatura · não debitado do banco</small>}
                {entry.kind==="transfer"&&<small>→ {findBank(entry.target_bank_id)}</small>}</>}</td>
            <td>{quickEnabled ? <QuickSelectCell label={"Caixa de "+entry.title} value={entry.box_id}
              disabled={quickBusy} saving={quickSaving===entry.id}
              onCommit={value=>quickSave(entry,"boxId",value)}
              options={view.boxes.filter(b=>b.active||b.id===entry.box_id)
                .map(b=>({value:b.id,label:b.name}))}/> : <strong>{findBox(entry.box_id)}</strong>}</td>
            <td>{quickEnabled ? <QuickInputCell type="date" label={"Vencimento de "+entry.title}
              value={entry.due_on??""} disabled={quickBusy} saving={quickSaving===entry.id}
              onCommit={value=>quickSave(entry,"dueOn",value)}/> :
              <strong>{shortDate(entry.due_on)}</strong>}
              {entry.status==="paid"&&<small>Pago {shortDate(entry.settled_on)}</small>}</td>
            <td>{quickEnabled && !entry.card_id ? <QuickSelectCell label={"Situação de "+entry.title}
              value={entry.status} disabled={quickBusy} saving={quickSaving===entry.id}
              onCommit={value=>quickSave(entry,"status",value)}
              options={[{value:"pending",label:"Pendente"},{value:"paid",label:"Pago"}]}/> :
              <span className={entry.status==="pending"?styles.pendingBadge:styles.paidBadge}>
                {entry.card_id?"Na fatura":entry.status==="pending"?"Pendente":"Efetivado"}
              </span>}</td>
            <td className={styles.expense}>{quickEnabled ? <QuickInputCell label={"Valor de "+entry.title}
              value={(entry.amount_cents/100).toFixed(2)} inputMode="decimal"
              disabled={quickBusy} saving={quickSaving===entry.id}
              onCommit={value=>quickSave(entry,"amountCents",value)}/> :
              "−"+money(entry.amount_cents)}</td>
            <td><div className={styles.rowActions}>
              {quickSaving===entry.id && <span className={styles.quickStatus}><Loader2 size={14} className={styles.quickSpin}/> Salvando</span>}
              {quickSaved===entry.id && !quickBusy && <span className={styles.quickSaved}><CheckCircle2 size={14}/> Salvo</span>}
              {entry.card_id && !closed && <button type="button" className={styles.payAction}
                onClick={()=>setSheetTab("cards")}>Ver fatura</button>}
              {entry.status === "pending" && !entry.card_id && !closed && <button type="button" className={styles.payAction}
                onClick={() => setEntryModal({ ...entryToDraft(entry), status: "paid", settledOn: today() })}>Pagar</button>}
              {!closed && <><button type="button" title="Editar lançamento" onClick={() => setEntryModal(entryToDraft(entry))}><Pencil size={15}/></button>
                <button type="button" title="Excluir lançamento" onClick={() => void deleteEntry(entry.id)}><Trash2 size={15}/></button></>}
              {closed && <LockKeyhole size={16} className={styles.lock}/>}
            </div></td>
          </tr>)}
        </tbody></table>
        {!visibleRows.length && <div className={styles.emptyTable}><ReceiptText size={27}/><strong>{sheetTab === "accounts" ? "Sua planilha está vazia" : "Nenhum lançamento neste período"}</strong><p>Altere os filtros ou cadastre a primeira conta deste mês.</p></div>}
        </div>
        <footer className={styles.tableFooter}><span>{visibleRows.length} linhas · {sheetTab === "accounts" ? "total da seleção: " + money(sheetTotal) : "entradas e transferências do mês"}</span>
          <span>{sheetTab === "accounts" ? quickEditing ? "Edição ativa: alterações salvas automaticamente, uma por vez." : "Clique em Habilitar edição para alterar as células diretamente." : "Valores efetivados já estão incluídos no saldo por banco e caixa."}</span></footer>
      </section>

      </>}
      {sheetTab==="other" && <section className={styles.panel}>
        <div className={styles.sectionHead}><div><span className={styles.eyebrow}>Fluxo efetivo</span>
          <h2>Recebimentos confirmados e faturas pagas</h2>
          <p>O histórico abaixo já faz parte dos saldos de banco e caixa. Não cadastre novamente as mesmas movimentações.</p></div></div>
        <div className={styles.sheetTableWrap}><table className={styles.table}>
          <thead><tr><th>Movimentação</th><th>Banco</th><th>Caixa</th><th>Data</th><th>Valor</th></tr></thead>
          <tbody>
            {view.expectedIncomes.filter(r=>r.status==="received"&&r.received_at&&brazilDate(r.received_at).slice(0,7)===month)
              .map(r=><tr key={r.id}><td><strong>{r.title}</strong><small>Recebimento confirmado</small></td>
                <td>{findBank(r.bank_id)}</td><td>{findBox(r.box_id)}</td>
                <td>{shortDate(brazilDate(r.received_at!))}</td>
                <td className={styles.income}>+{money(r.amount_cents)}</td></tr>)}
            {view.cardPayments.filter(p=>brazilDate(p.paid_at).slice(0,7)===month).map(p=><tr key={p.id}>
              <td><strong>{view.cards.find(c=>c.id===p.card_id)?.name??"Fatura de cartão"}</strong>
                <small>Pagamento real da fatura {p.invoice_month.slice(0,7)}</small></td>
              <td>{findBank(p.bank_id)}</td><td>{findBox(p.box_id)}</td>
              <td>{shortDate(brazilDate(p.paid_at))}</td><td className={styles.expense}>−{money(p.amount_cents)}</td></tr>)}
          </tbody></table></div>
          {!view.expectedIncomes.some(r=>r.status==="received"&&r.received_at&&brazilDate(r.received_at).slice(0,7)===month)
           &&!view.cardPayments.some(p=>brazilDate(p.paid_at).slice(0,7)===month)
           &&<p className={styles.empty}>Nenhuma fatura paga ou previsão confirmada neste mês.</p>}
      </section>}
      {view.origins.length > 0 && sheetTab === "accounts" && <section className={styles.originPanel}>
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
          {setting.id && setting.type !== "origin" && <div className={styles.deleteWarning}>
            <div><strong>Excluir {setting.type === "bank" ? "banco" : "caixa"}</strong>
              <span>Somente cadastros sem lançamentos vinculados podem ser apagados. Caso tenha histórico, desative-o.</span></div>
            <button type="button" className={styles.dangerButton} disabled={saving}
              onClick={() => void deleteSetting()}><Trash2 size={16}/> Apagar</button>
          </div>}
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
            {entryModal.kind==="expense"&&<label className={styles.full}>Como será paga a conta?
              <select value={entryModal.cardId} onChange={e=>{
                const cardId=e.target.value;
                const selected=view.cards.find(c=>c.id===cardId);
                setEntryModal({...entryModal,cardId,status:cardId?"pending":entryModal.status,
                  dueOn:selected?invoiceDueDate(entryModal.dueOn.slice(0,7)+"-01",selected.due_day):entryModal.dueOn,
                  bankId:selected?.legacy_bank_id??entryModal.bankId});
              }}>
                <option value="">Diretamente por banco (Pix, boleto, débito)</option>
                {view.cards.filter(c=>c.active||c.id===entryModal.cardId).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}
              </select>
              <small className={styles.inputHelp}>No cartão, a compra compõe a fatura; o saldo sai do banco somente no pagamento da fatura.</small>
            </label>}
            {(!entryModal.cardId||entryModal.kind!=="expense")&&<label>Banco de {entryModal.kind === "transfer" ? "origem" : "pagamento"}<select required value={entryModal.bankId} onChange={(e) => setEntryModal({...entryModal,bankId:e.target.value})}>
              <option value="">Selecione o banco</option>{availableBanks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}
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
            {entryModal.kind === "expense" && !entryModal.id && <label>Quantidade total de parcelas
              <input type="number" min={1} max={120} required value={entryModal.installmentTotal}
                onChange={(e) => {const total = Math.max(1,Math.min(120,Number(e.target.value)||1));setEntryModal({...entryModal,installmentTotal:total,installmentNumber:Math.min(entryModal.installmentNumber,total)});}}/>
            </label>}
            {entryModal.kind === "expense" && !entryModal.id && entryModal.installmentTotal > 1 && <>
              <label>Parcela que está cadastrando
                <input type="number" min={1} max={entryModal.installmentTotal} required value={entryModal.installmentNumber}
                  onChange={(e) => setEntryModal({...entryModal,installmentNumber:Number(e.target.value)||1})}/>
              </label>
              <div className={styles.installmentInfo}>
                <CalendarDays size={18}/>
                <span>Esta será a parcela <strong>{entryModal.installmentNumber}/{entryModal.installmentTotal}</strong>.
                  Serão criadas <strong>{entryModal.installmentTotal-entryModal.installmentNumber+1} linhas</strong>,
                  uma por mês, até <strong>{entryModal.dueOn ? labelMonth(shiftMonthlyDate(entryModal.dueOn,entryModal.installmentTotal-entryModal.installmentNumber).slice(0,7)) : "mês a definir"}</strong>.
                  As próximas parcelas começam pendentes.</span>
              </div>
            </>}
            {entryModal.kind === "expense" && !!entryModal.id && entryModal.installmentTotal > 1 && <div className={styles.installmentInfo}>
              <CalendarDays size={18}/><span>Parcela <strong>{entryModal.installmentNumber}/{entryModal.installmentTotal}</strong>.
                As alterações deste registro não modificam as outras parcelas.</span>
            </div>}
            {entryModal.kind === "expense" && !entryModal.cardId && <label>Situação<select value={entryModal.status}
              onChange={(e) => setEntryModal({...entryModal,status:e.target.value as Entry["status"]})}>
              <option value="pending">Pendente (não reduz o saldo)</option><option value="paid">Pago (reduz o saldo)</option></select></label>}
            {entryModal.kind === "expense" && <label>{entryModal.cardId?"Vencimento da fatura":"Vencimento"}<input required type="date" value={entryModal.dueOn}
              onChange={(e) => setEntryModal({...entryModal,dueOn:e.target.value})}/></label>}
            {entryModal.kind === "opening" && <label>Data e hora da movimentação (opcional)
              <input type="datetime-local" value={entryModal.movementAt}
                onChange={(e) => setEntryModal({...entryModal,movementAt:e.target.value,settledOn:e.target.value.slice(0,10)})}/>
              <small className={styles.inputHelp}>Se ficar em branco, registra a data e a hora atuais.</small>
            </label>}
            {entryModal.kind !== "opening" && (entryModal.kind !== "expense" || entryModal.status === "paid") && <label>Data {entryModal.kind === "expense" ? "do pagamento" : "da movimentação"}
              <input type="date" value={entryModal.settledOn} onChange={(e) => setEntryModal({...entryModal,settledOn:e.target.value,movementAt:""})}/>
              <small className={styles.inputHelp}>Sem data, utiliza o momento do registro.</small>
            </label>}
            <label className={styles.full}>Observações (opcional)<textarea rows={2} maxLength={1000} value={entryModal.notes}
              onChange={(e) => setEntryModal({...entryModal,notes:e.target.value})} placeholder="Detalhes deste lançamento"/></label>
          </div>
          {entryModal.kind === "expense" && !!entryModal.cardId && <div className={styles.formInfo}>A compra entrará como obrigação no cartão. Para pagar, abra a aba <strong>Faturas de cartões</strong> e registre a saída do banco e caixa responsáveis. Não marque compras individuais como pagas.</div>}
          {entryModal.kind === "expense" && !entryModal.cardId && <div className={styles.formInfo}>Ao marcar como pago, o valor será abatido somente do caixa <strong>{findBox(entryModal.boxId)}</strong> dentro do banco <strong>{findBank(entryModal.bankId)}</strong>. O mês contábil segue a data do pagamento; para contas pendentes, segue o vencimento.</div>}
          {entryModal.kind === "opening" && <div className={styles.formInfo}>Registre o saldo inicial uma única vez para cada banco e caixa. Os meses seguintes herdam automaticamente o saldo; novos aportes somam ao valor anterior.</div>}
          {entryModal.kind === "transfer" && <div className={styles.formInfo}>A transferência debita o caixa de origem e credita o destino em uma única operação. Se o banco for o mesmo, o saldo consolidado dele não muda.</div>}
          {error && <div className={styles.formError} role="alert">{error}</div>}
          <div className={styles.formActions}><button type="button" className={styles.outlineButton} onClick={() => setEntryModal(null)}>Cancelar</button>
            <button type="submit" className={styles.primaryButton} disabled={saving}>{saving ? "Salvando..." : entryModal.id ? "Salvar alterações" : "Registrar lançamento"}</button></div>
        </form>
      </section></div>}
  </div>;
}
