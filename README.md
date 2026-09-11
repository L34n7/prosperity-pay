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

## Objetivo da primeira fase

1. Checkout dos planos Prosperity.
2. Registro de pagamentos e assinaturas.
3. Atribuição de afiliados por link/referral.
4. Regras configuráveis de comissão.
5. Conciliação por webhook.
6. Comissão pendente, disponível, paga ou estornada.

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

## Banco de dados

A migration inicial está em `supabase/migrations/202609100001_initial_payments.sql`.

Ela cria a fundação para provedores, clientes, afiliados, links, atribuições, regras de comissão, assinaturas, pagamentos, transações, comissões, repasses e eventos de webhook.

As tabelas nascem com RLS habilitado e sem políticas públicas. No início, operações administrativas do backend devem usar a service role somente no servidor.

## Fundação visual

O painel administrativo usa uma estrutura responsiva compartilhada com sidebar recolhível, topbar, componentes financeiros e tema centralizado por tokens CSS. As rotas disponíveis nesta primeira versão são:

- `/dashboard`: KPIs, volume de pagamentos, distribuição por status e transações recentes.
- `/dashboard1`: conceito visual alternativo com navegação horizontal, transições cinematográficas e módulos interativos.
- `/pagamentos`: busca, filtros e drawer com composição financeira e linha do tempo.
- `/afiliados`: indicadores, busca, cards e detalhes do parceiro.
- `/comissoes`: resumo financeiro, busca e filtros por status.
- `/checkout/basico`: checkout público demonstrativo com indicação por `?ref=CODIGO` e etapa PIX.

Os dados visuais são demonstrativos e ficam isolados em `src/lib/dashboard/mock-data.ts`. Nenhuma cobrança real é iniciada pelos componentes de interface.

## Próximas etapas

- Criar projeto Supabase e executar a migration inicial.
- Configurar variáveis na Vercel.
- Implementar autenticação administrativa.
- Implementar checkout de plano e criação de pagamento no Mercado Pago.
- Implementar validação e idempotência do webhook Mercado Pago.
- Integrar ativação/renovação com o CRM Prosperity.
