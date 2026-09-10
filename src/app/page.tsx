import {
  BadgeDollarSign,
  CreditCard,
  Link2,
  ReceiptText,
  RefreshCcw,
  Users,
} from "lucide-react";

const modules = [
  {
    title: "Afiliados",
    description: "Cadastro, links, atribuição e regras de comissão.",
    icon: Users,
  },
  {
    title: "Checkout",
    description: "Checkout próprio da Prosperity conectado aos provedores.",
    icon: Link2,
  },
  {
    title: "Pagamentos",
    description: "Transações, conciliação, estornos e idempotência.",
    icon: CreditCard,
  },
  {
    title: "Assinaturas",
    description: "Ativação, renovação, inadimplência e cancelamento.",
    icon: RefreshCcw,
  },
  {
    title: "Comissões",
    description: "Valores pendentes, disponíveis, pagos e estornados.",
    icon: BadgeDollarSign,
  },
  {
    title: "Financeiro",
    description: "Receita bruta, tarifas, comissão e receita líquida.",
    icon: ReceiptText,
  },
];

export default function Home() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#15304f_0%,#0b1727_32%,#07101c_70%)] px-5 py-10 text-slate-100 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-6xl">
        <header className="mb-10 flex flex-col gap-6 border-b border-white/10 pb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
              Base inicial
            </div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Prosperity Pay
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              Camada própria de orquestração de pagamentos, começando com os
              planos Prosperity e preparada para afiliados e múltiplos provedores.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-300 backdrop-blur">
            Provedor inicial: <strong className="text-white">Mercado Pago</strong>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {modules.map(({ title, description, icon: Icon }) => (
            <article
              key={title}
              className="rounded-2xl border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/10 backdrop-blur transition hover:-translate-y-0.5 hover:border-cyan-300/25 hover:bg-white/[0.075]"
            >
              <div className="mb-5 flex size-11 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-300/10 text-cyan-200">
                <Icon size={21} />
              </div>
              <h2 className="text-lg font-semibold">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
            </article>
          ))}
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-black/15 p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            Fluxo inicial
          </p>
          <p className="mt-3 font-mono text-sm leading-7 text-slate-300">
            Checkout Prosperity → Mercado Pago → webhook validado → pagamento
            aprovado → assinatura ativada → comissão pendente
          </p>
        </section>
      </div>
    </main>
  );
}
