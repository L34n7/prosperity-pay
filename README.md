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

## Aplicação operacional

- `/login`, `/cadastro`, `/esqueci-senha` e `/redefinir-senha`: Supabase Auth com cookies e confirmação por e-mail.
- `/dashboard`, `/pagamentos`, `/comissoes`, `/saldo` e `/saques`: dados reais do usuário; a área interna exige sessão.
- `/produtos` e `/produtos/[id]`: cadastro, gestão de ofertas, links de checkout, afiliados e convites de coprodução.
- `/integracoes` e `/conta`: conexão Mercado Pago, identidade e chaves Pix.
- `/checkout/[slug]`: oferta pública ativa com pagamento redirecionado para o Mercado Pago. O retorno consulta o status do pedido registrado, sem presumir aprovação pela URL.
- `/admin`: acesso restrito a `admin` ou `finance_operator`, revisão de identidade, Pix, saques, conexões, usuários e logs.

`/dashboard1` redireciona ao dashboard real; os dados e componentes demonstrativos foram removidos. O checkout atual suporta **venda avulsa**; a criação de ofertas recorrentes é rejeitada enquanto a API de assinaturas não estiver implementada. O preço, split e comissões continuam calculados no backend. A taxa efetiva do processador, conhecida após a confirmação, gera um débito compensatório único no saldo interno do produtor; o snapshot inicial permanece imutável.

## Ativação em produção

1. Configure todas as variáveis de `.env.example` no projeto Vercel, especialmente URL e chave pública do Supabase, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `FINANCIAL_ENCRYPTION_KEY`, credenciais OAuth e segredo do webhook Mercado Pago. Nunca coloque service role, token ou chave de criptografia em variáveis `NEXT_PUBLIC_`.
2. Configure no Supabase Auth a URL pública do site e os redirects `/auth/confirm` e `/redefinir-senha`; confirme as configurações de e-mail. Configure na aplicação Mercado Pago o redirect HTTPS que coincide com `MERCADO_PAGO_REDIRECT_URI` e o webhook `/api/webhooks/mercadopago`.
3. Cadastre a primeira conta, confirme o e-mail e atribua **manualmente** o papel de operador ao usuário correto em `user_roles`. Não há promoção automática do primeiro cadastro para administrador.
4. Acesse `/admin` e configure a conexão central com o token da conta Prosperity caso vá usar `prosperity_balance`. Para recebimento direto, cada produtor conecta sua própria conta em `/integracoes`.
5. Crie produto e oferta, ative ambos, faça uma compra de teste no Mercado Pago e confira o retorno e o webhook antes de usar em produção.

As verificações de identidade e chaves Pix exigem revisão humana. Um operador deve comprovar a identidade por um procedimento externo e registrar a referência ao aprovar; os saques são manuais e pedem referência do comprovante para marcar como pagos. O projeto ainda não envia convites por e-mail automaticamente: copie o link retornado na gestão do produto.
