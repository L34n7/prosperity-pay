import { BadgeDollarSign, CircleDollarSign, Plus, UserRoundCheck, WalletCards } from "lucide-react";
import { AffiliatesView } from "@/components/affiliates/affiliates-view";
import { StatCard } from "@/components/dashboard/stat-card";
import { PageHeader } from "@/components/ui/page-header";
import { affiliates } from "@/lib/dashboard/mock-data";

export default function AffiliatesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Programa de parceiros"
        title="Afiliados"
        description="Acompanhe indicações, vendas e valores de comissão de cada parceiro."
        action={<button className="primary-button"><Plus size={17} /> Novo afiliado</button>}
      />
      <section className="stats-grid affiliate-kpis">
        <StatCard title="Afiliados ativos" value="28" change={12} icon={UserRoundCheck} description="Parceiros habilitados para indicar novos clientes." />
        <StatCard title="Vendas geradas" value="117" change={21.5} icon={WalletCards} description="Quantidade de vendas atribuídas aos afiliados no período." />
        <StatCard title="Volume vendido" value="R$ 34.184" change={18.7} icon={CircleDollarSign} description="Valor bruto vendido por todos os afiliados." />
        <StatCard title="Comissão disponível" value="R$ 1.515" change={8.2} icon={BadgeDollarSign} accent="gold" description="Valor já liberado para o próximo repasse." />
      </section>
      <AffiliatesView data={affiliates} />
    </>
  );
}
