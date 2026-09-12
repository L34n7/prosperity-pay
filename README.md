# Prosperity Pay

Camada de pagamentos da Prosperity, criada para começar com vendas próprias do CRM e evoluir sem acoplamento a um único processador.

## Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS 4
- Supabase
- Mercado Pago como primeiro provedor
- Vercel para deploy

## Domínio implementado

O projeto suporta uma conta única por usuário e papéis contextuais de produtor,
coprodutor e afiliado. Produtos possuem ofertas e escolhem explicitamente um dos
modelos de liquidação:

- `connected_account`: checkout criado com o token OAuth do produtor e split 1:1
  entre produtor e Prosperity.
- `prosperity_balance`: checkout criado na conta da Prosperity e distribuição
  interna através do ledger.

O cálculo financeiro fica centralizado em `FinancialDistributionService`, usa
centavos inteiros e congela um snapshot por pedido. Caso a mesma pessoa seja
coprodutora e tenha originado a venda como afiliada, a coprodução prevalece.

## Arquitetura

O domínio da Prosperity não depende diretamente do Mercado Pago. O código consome a interface `PaymentProvider`, e cada processador implementa essa interface em `src/lib/payments/providers`.

```text
CRM Prosperity / Checkout
          |
          v
    Prosperity Pay
          |
          v
    PaymentProvider
          |
          +-- MercadoPagoProvider
          +-- futuros provedores
```

## Preparar ambiente

Copie `.env.example` para `.env.local` e preencha as credenciais depois de criar o projeto Supabase e configurar o Mercado Pago.

```bash
npm install
npm run dev
```

## Banco de dados e segurança

As migrations em `supabase/migrations` são a fonte versionada do schema aplicado.
Elas criam 31 tabelas públicas com RLS habilitado e forçado, além de um schema
`private` para credenciais criptografadas. O saldo é derivado dos lançamentos
imutáveis do ledger. Saques usam lock transacional para impedir double-spend e
estornos devem ser lançamentos compensatórios — registros financeiros não são
apagados.

Os tipos atuais do banco estão em `src/lib/supabase/database.types.ts`.

## Backend HTTP

- `POST /api/auth/signup`
- `GET|POST /api/products`
- `GET|POST /api/products/:id/offers`
- `PUT /api/products/:id/affiliate-program`
- `POST /api/affiliate-programs/:id/join`
- `POST /api/products/:id/coproducers/invitations`
- `POST /api/coproducer-invitations/respond`
- `GET|POST /api/financial-profile/identity`
- `GET|POST /api/financial-profile/pix`
- `GET /api/balance`
- `GET|POST /api/withdrawals`
- `GET /api/integrations/mercadopago/connect`
- `GET /api/integrations/mercadopago/callback`
- `POST /api/checkout/orders` (exige `Idempotency-Key`)
- `POST /api/webhooks/mercadopago`
- rotas administrativas para KYC, Pix, conexão central e saques manuais

O webhook valida `x-signature` por HMAC, busca o pagamento diretamente no
Mercado Pago e só então atualiza o pedido e publica as alocações no ledger.

## Fundação visual

O painel administrativo usa uma estrutura responsiva compartilhada com sidebar recolhível, topbar, componentes financeiros e tema centralizado por tokens CSS. As rotas disponíveis nesta primeira versão são:

- `/dashboard`: KPIs, volume de pagamentos, distribuição por status e transações recentes.
- `/dashboard1`: conceito visual alternativo com navegação horizontal, transições cinematográficas e módulos interativos.
- `/pagamentos`: busca, filtros e drawer com composição financeira e linha do tempo.
- `/afiliados`: indicadores, busca, cards e detalhes do parceiro.
- `/comissoes`: resumo financeiro, busca e filtros por status.
- `/checkout/basico`: checkout público demonstrativo com indicação por `?ref=CODIGO` e etapa PIX.

Os dados visuais são demonstrativos e ficam isolados em `src/lib/dashboard/mock-data.ts`. Nenhuma cobrança real é iniciada pelos componentes de interface.

## Configuração externa necessária

- Preencher as variáveis de `.env.example` na Vercel.
- Criar a aplicação Marketplace no Mercado Pago, habilitar OAuth/PKCE e registrar
  a Redirect URL e o webhook HTTPS.
- Conceder `admin` ou `finance_operator` em `user_roles` ao primeiro operador.
- Registrar a conexão central uma vez em
  `POST /api/admin/payment-connections/platform`.
- Integrar as telas do dashboard aos endpoints; os protótipos visuais continuam
  usando os dados demonstrativos isolados.
