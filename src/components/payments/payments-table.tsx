"use client";

import { ChevronRight, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import type { Payment } from "@/lib/dashboard/types";
import { dateFormatter, moneyFormatter } from "@/lib/dashboard/formatters";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { SelectField } from "@/components/ui/select-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { PaymentDrawer } from "./payment-drawer";

type PaymentsTableProps = {
  data: Payment[];
  compact?: boolean;
};

export function PaymentsTable({ data, compact = false }: PaymentsTableProps) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [method, setMethod] = useState("all");
  const [affiliate, setAffiliate] = useState("all");
  const [selectedPayment, setSelectedPayment] = useState<Payment | null>(null);

  const filtered = useMemo(() => {
    const term = search.toLocaleLowerCase("pt-BR");
    return data.filter((payment) => {
      const matchesSearch = !term || [payment.customer, payment.email, payment.id, payment.externalId]
        .some((value) => value.toLocaleLowerCase("pt-BR").includes(term));
      return matchesSearch
        && (status === "all" || payment.status === status)
        && (method === "all" || payment.method === method)
        && (affiliate === "all" || (affiliate === "direct" ? !payment.affiliate : payment.affiliate === affiliate));
    });
  }, [affiliate, data, method, search, status]);

  const visible = compact ? filtered.slice(0, 5) : filtered;

  return (
    <>
      <section className="panel table-panel">
        <div className="panel-heading table-heading">
          <div><p className="eyebrow">Movimentações</p><h2>{compact ? "Transações recentes" : "Todas as transações"}</h2></div>
          {compact && <a className="text-link" href="/pagamentos">Ver todas <ChevronRight size={15} /></a>}
        </div>

        <div className="table-tools">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar cliente, e-mail ou ID" />
          <div className="filter-group">
            <span className="filter-label"><SlidersHorizontal size={15} /> Filtros</span>
            <SelectField value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar por status">
              <option value="all">Todos os status</option>
              <option value="approved">Aprovados</option>
              <option value="pending">Pendentes</option>
              <option value="processing">Processando</option>
              <option value="rejected">Falharam</option>
              <option value="refunded">Estornados</option>
            </SelectField>
            {!compact && (
              <>
                <SelectField value={method} onChange={(event) => setMethod(event.target.value)} aria-label="Filtrar por método">
                  <option value="all">Todos os métodos</option>
                  <option value="PIX">PIX</option>
                  <option value="Cartão">Cartão</option>
                </SelectField>
                <SelectField value={affiliate} onChange={(event) => setAffiliate(event.target.value)} aria-label="Filtrar por afiliado">
                  <option value="all">Todos os afiliados</option>
                  <option value="direct">Venda direta</option>
                  <option value="Lucas Martins">Lucas Martins</option>
                  <option value="Juliana Alves">Juliana Alves</option>
                  <option value="Marcos Lima">Marcos Lima</option>
                </SelectField>
              </>
            )}
          </div>
        </div>

        {visible.length ? (
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Cliente</th><th>Valor</th><th>Método</th><th>Afiliado</th><th>Status</th><th>Data</th><th><span className="sr-only">Abrir</span></th></tr></thead>
              <tbody>
                {visible.map((payment) => (
                  <tr key={payment.id} onClick={() => setSelectedPayment(payment)}>
                    <td><strong>{payment.customer}</strong><span>{payment.email}</span></td>
                    <td><strong>{moneyFormatter.format(payment.amount)}</strong><span>{payment.id}</span></td>
                    <td><span className={`method-icon method-${payment.method === "PIX" ? "pix" : "card"}`}>{payment.method === "PIX" ? "◆" : "▰"}</span>{payment.method}</td>
                    <td>{payment.affiliate ?? <span className="muted">Venda direta</span>}</td>
                    <td><StatusBadge status={payment.status} /></td>
                    <td>{dateFormatter.format(new Date(payment.createdAt))}</td>
                    <td><button className="row-action" aria-label={`Abrir ${payment.id}`}><ChevronRight size={17} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <EmptyState title="Nenhuma transação encontrada" description="Ajuste a busca ou os filtros para visualizar outros resultados." />}
        {!compact && <div className="table-footer"><span>Exibindo {visible.length} de {data.length} transações</span><div><button disabled>Anterior</button><button className="active">1</button><button disabled>Próxima</button></div></div>}
      </section>
      <PaymentDrawer payment={selectedPayment} onClose={() => setSelectedPayment(null)} />
    </>
  );
}
