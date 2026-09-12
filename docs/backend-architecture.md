# Arquitetura backend do Prosperity Pay

## Entrada e distribuição do dinheiro

`connected_account` usa a credencial OAuth do produtor para criar o Checkout Pro.
O `marketplace_fee` corresponde à taxa Prosperity mais as obrigações de afiliados
e coprodutores. O Mercado Pago faz somente o split produtor ↔ Prosperity.

`prosperity_balance` usa a conexão central da Prosperity. Após a confirmação do
pagamento, produtor, afiliado e coprodutor recebem créditos internos; a taxa da
plataforma vai para a conta contábil de receita.

## Integridade financeira

- Todos os valores do domínio são `bigint` em centavos.
- `financial_snapshots` e `financial_allocations` são imutáveis.
- `ledger_entries` é append-only e possui constraint idempotente por origem.
- O mesmo webhook não pode publicar o mesmo crédito duas vezes.
- A disponibilidade vem de `available_at`, sem reescrever o lançamento.
- O saque insere imediatamente um débito de reserva sob lock por usuário.
- Rejeição, cancelamento ou falha do saque cria um crédito compensatório.
- Comissões de afiliação e coprodução não acumulam para a mesma pessoa.

## Limites deliberados do MVP

- Saque por Pix é manual e exige confirmação do operador.
- Não existe carteira P2P, depósito, transferência entre usuários ou pagamento
  com saldo.
- Não existe split Mercado Pago 1:N.
- Recorrência está modelada no banco, mas depende da escolha e homologação do
  produto recorrente do Mercado Pago antes de ativar cobrança real.
- A taxa efetiva do gateway é conciliada no pagamento; o checkout não aceita
  valores ou comissões calculados pelo navegador.

## Segurança

- Todas as tabelas públicas usam RLS forçado.
- Tokens do Mercado Pago são cifrados em AES-256-GCM e persistidos no schema
  `private`.
- `service_role`, segredo de webhook e chave de cifragem são apenas do servidor.
- Funções `SECURITY DEFINER` usadas por usuários ficam no schema não exposto;
  wrappers públicos executam como invocador e conferem `auth.uid()`.
- KYC e chave Pix nunca retornam o valor completo ao cliente.
