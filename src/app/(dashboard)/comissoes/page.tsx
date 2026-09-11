import { BanknoteArrowUp, CalendarClock, CircleCheckBig, Download } from "lucide-react";
import { CommissionsTable } from "@/components/commissions/commissions-table";
import { PageHeader } from "@/components/ui/page-header";
import { commissions } from "@/lib/dashboard/mock-data";

export default function CommissionsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Financeiro de parceiros"
        title="Comissões"
        description="Controle valores pendentes, disponíveis, pagos e estornados."
        action={<button className="secondary-button"><Download size={16} /> Exportar relatório</button>}
      />
      <section className="summary-strip">
        <div><span className="summary-icon warning"><CalendarClock size={19} /></span><p><small>Pendente</small><strong>R$ 1.842,70</strong><em>liberação em até 7 dias</em></p></div>
        <div><span className="summary-icon success"><BanknoteArrowUp size={19} /></span><p><small>Disponível</small><strong>R$ 1.515,40</strong><em>pronto para repasse</em></p></div>
        <div><span className="summary-icon neutral"><CircleCheckBig size={19} /></span><p><small>Pago no mês</small><strong>R$ 4.927,80</strong><em>18 repasses concluídos</em></p></div>
      </section>
      <CommissionsTable data={commissions} />
    </>
  );
}
