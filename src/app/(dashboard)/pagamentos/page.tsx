import { Download, Plus } from "lucide-react";
import { PaymentsTable } from "@/components/payments/payments-table";
import { PageHeader } from "@/components/ui/page-header";
import { payments } from "@/lib/dashboard/mock-data";

export default function PaymentsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operação financeira"
        title="Pagamentos"
        description="Consulte transações, acompanhe status e visualize a composição de cada venda."
        action={<div className="button-row"><button className="secondary-button"><Download size={16} /> Exportar</button><button className="primary-button"><Plus size={17} /> Novo pagamento</button></div>}
      />
      <div className="context-banner">
        <div><span className="live-dot" /> <strong>Processamento operacional</strong></div>
        <p>O painel está preparado para receber os eventos do Mercado Pago através da camada <code>PaymentProvider</code>.</p>
      </div>
      <PaymentsTable data={payments} />
    </>
  );
}
