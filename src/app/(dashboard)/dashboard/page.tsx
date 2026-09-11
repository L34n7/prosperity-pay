import { BadgeDollarSign, CircleDollarSign, Percent, WalletCards } from "lucide-react";
import { PaymentStatusChart } from "@/components/dashboard/payment-status-chart";
import { PaymentVolumeChart } from "@/components/dashboard/payment-volume-chart";
import { StatCard } from "@/components/dashboard/stat-card";
import { PaymentsTable } from "@/components/payments/payments-table";
import { PageHeader } from "@/components/ui/page-header";
import { SelectField } from "@/components/ui/select-field";
import { payments } from "@/lib/dashboard/mock-data";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        eyebrow="Olá, Leandro"
        title="Dashboard financeiro"
        description="Acompanhe em tempo real o desempenho dos seus pagamentos."
        action={
          <SelectField defaultValue="30" aria-label="Selecionar período">
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
            <option value="90">Últimos 90 dias</option>
          </SelectField>
        }
      />

      <section className="stats-grid">
        <StatCard title="Volume processado" value="R$ 162.640" change={18.4} icon={WalletCards} description="Valor bruto de todos os pagamentos processados no período." />
        <StatCard title="Receita líquida" value="R$ 139.820" change={15.2} icon={CircleDollarSign} description="Valor após taxas do processador e comissões de afiliados." />
        <StatCard title="Comissões a pagar" value="R$ 4.842" change={-3.1} icon={BadgeDollarSign} accent="gold" description="Comissões pendentes e disponíveis que ainda não foram repassadas." />
        <StatCard title="Taxa de aprovação" value="92,8%" change={2.6} icon={Percent} description="Percentual de pagamentos aprovados entre todas as tentativas." />
      </section>

      <section className="charts-grid">
        <PaymentVolumeChart />
        <PaymentStatusChart />
      </section>

      <PaymentsTable data={payments} compact />
    </>
  );
}
