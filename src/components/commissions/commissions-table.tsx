"use client";

import { Download, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import type { Commission } from "@/lib/dashboard/types";
import { moneyFormatter } from "@/lib/dashboard/formatters";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";
import { SelectField } from "@/components/ui/select-field";
import { StatusBadge } from "@/components/ui/status-badge";

export function CommissionsTable({ data }: { data: Commission[] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const filtered = useMemo(() => {
    const term = search.toLocaleLowerCase("pt-BR");
    return data.filter((commission) =>
      (!term || [commission.id, commission.saleId, commission.affiliate].some((value) => value.toLocaleLowerCase("pt-BR").includes(term)))
      && (status === "all" || commission.status === status),
    );
  }, [data, search, status]);

  return (
    <section className="panel table-panel">
      <div className="table-tools commissions-tools">
        <SearchInput value={search} onChange={setSearch} placeholder="Buscar venda, comissão ou afiliado" />
        <div className="filter-group">
          <span className="filter-label"><SlidersHorizontal size={15} /> Filtros</span>
          <SelectField value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filtrar status da comissão">
            <option value="all">Todos os status</option>
            <option value="pending">Pendentes</option>
            <option value="available">Disponíveis</option>
            <option value="paid">Pagas</option>
            <option value="cancelled">Canceladas</option>
            <option value="reversed">Estornadas</option>
          </SelectField>
          <button className="secondary-button"><Download size={16} /> Exportar</button>
        </div>
      </div>
      {filtered.length ? (
        <div className="data-table-wrap">
          <table className="data-table commissions-table">
            <thead><tr><th>Venda</th><th>Afiliado</th><th>Valor da venda</th><th>Regra</th><th>Comissão</th><th>Liberação</th><th>Status</th></tr></thead>
            <tbody>{filtered.map((commission) => (
              <tr key={commission.id}>
                <td><strong>{commission.saleId}</strong><span>{commission.id}</span></td>
                <td>{commission.affiliate}</td>
                <td>{moneyFormatter.format(commission.saleAmount)}</td>
                <td>{commission.rule}</td>
                <td><strong>{moneyFormatter.format(commission.amount)}</strong></td>
                <td>{commission.availableAt}</td>
                <td><StatusBadge status={commission.status} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : <EmptyState title="Nenhuma comissão encontrada" description="Altere a busca ou selecione outro status." />}
    </section>
  );
}
