# Contabilidade interna — Prosperity Pay

Este módulo é exclusivo do administrador da plataforma em `/contabilidade`. É um **livro-caixa de gestão**, independente do saldo dos produtores, pagamentos, saques, comissões e das alocações do gateway. Não sincroniza bancos e não movimenta dinheiro de verdade.

## Bancos e caixas

- **Banco** representa a instituição/conta real (Inter, Mercado Pago, Sicredi).
- **Caixa** representa o responsável interno pelos valores (Leandro, CRM, Lucas, Sonia, Prosperity Pay), identificado como pessoa física ou jurídica.
- **Origem** categoriza a despesa ou receita (Cartão Inter, Internet etc.). A origem **não** é o banco de pagamento.
- Cada lançamento registra banco + caixa e opcionalmente origem. O banco agrega os saldos de todos os caixas; um caixa agrega seus saldos mantidos em vários bancos.
- A estrutura inicial sugerida cadastra três bancos e cinco caixas **sem quaisquer valores fictícios**. É possível cadastrar outros, renomear e arquivar bancos/caixas sem apagar o histórico.

## Planilha mensal e contas parceladas

A tela inicial abre a aba **Planilha de contas**. Ela funciona como uma relação mensal de contas, com uma linha por parcela, origem, banco, caixa, vencimento, valor, situação e ações para pagar/editar/excluir. A aba **Saldos por banco e caixa** mostra uma grade de bancos × caixas; clicar na célula permite cadastrar saldo inicial ou aporte para aquela combinação. A aba **Entradas e transferências** mostra os lançamentos internos sem misturá-los com a relação de despesas.

Ao registrar uma conta, **Quantidade total de parcelas** e **Parcela que está cadastrando** permitem começar no meio do parcelamento. Exemplo: parcela **2 de 5** com vencimento em novembro de 2026 insere quatro linhas: 2/5 novembro de 2026, 3/5 dezembro de 2026, 4/5 janeiro de 2027 e 5/5 fevereiro de 2027. As parcelas posteriores são criadas como pendentes, na mesma data de vencimento de cada mês (ajustada para o último dia quando necessário). O valor é considerado **por parcela**, não o valor total da compra. A primeira parcela respeita a situação selecionada. Cada linha pode ser quitada ou ajustada independentemente. O grupo é criado em uma única inserção transacional, inclusive nos meses futuros. Não são usados agendadores, jobs ou crons para gerar as demais parcelas.

No modal **Saldo inicial / aporte**, o campo **Data e hora da movimentação** é opcional. Em branco, registra o instante atual no horário de Brasília. Se for fornecido, esse instante é preservado para fins de auditoria; a competência é o mês da data informada. Outros lançamentos pagos também registram `movement_at` ao efetivar, independentemente do registro `created_at`.

Bancos e caixas podem ser **excluídos** se nunca tiverem lançamentos vinculados, respeitando as chaves estrangeiras. Se possuem histórico, a exclusão é bloqueada para proteger os saldos e o usuário deve **desativá-los**.

## Tipos de lançamento

1. **Saldo inicial / aporte**: crédito efetivo no banco e no caixa; use para registrar o dinheiro que já existe quando começar a controlar.
2. **Entrada**: receita manual efetivada (não importa vendas automaticamente).
3. **Conta / despesa**: pendente ou paga. Pendente entra em *contas a pagar*, mas não deduz o saldo; paga deduz o valor do banco e do caixa selecionados.
4. **Transferência**: debita banco/caixa de origem e credita banco/caixa de destino em um único registro. Quando o banco é o mesmo, o saldo bancário não muda.

Exemplo: Inter com R$ 1.000 atribuídos ao caixa Leandro e R$ 1.000 ao caixa CRM possui saldo bancário de R$ 2.000. Pagar Mercado Livre (R$ 300, origem Cartão Inter, caixa Leandro) e Vercel (R$ 600, origem Cartão Inter, caixa CRM) deixa R$ 700 no caixa Leandro, R$ 400 no CRM e R$ 1.100 no banco Inter. Pagar Linkspeed (R$ 100, origem Internet, caixa Leandro, banco Inter) reduz o caixa Leandro a R$ 600 e o saldo bancário a R$ 1.000.

## Competência, vencimentos e fechamento

- A contabilidade deste módulo segue **regime de caixa**. Para lançamentos efetivados, o mês é o da **data do pagamento/movimentação**. Para contas pendentes, o mês é o do **vencimento**.
- Se uma conta vencida for paga em outro mês, o lançamento é movido para o mês efetivo do pagamento, preservando o vencimento original.
- O saldo anterior transporta automaticamente o acumulado de meses anteriores. O saldo consolidado apresenta a posição ao final do mês filtrado.
- **Fechar mês** impede inclusões, alterações e exclusões no período. O banco bloqueia o fechamento se houver contas pendentes do mês. Quite ou reprograme essas contas antes de encerrar. É possível reabrir manualmente.
- A exportação CSV usa a competência selecionada e pode ser importada em uma planilha.

## Segurança e limites

Os dados ficam em tabelas `finance_*` com RLS e acesso apenas ao próprio usuário administrador da plataforma. As referências banco/caixa/origem são validadas por chaves estrangeiras compostas, o que impede associação a registros de outro dono. Ações de edição em mês fechado são bloqueadas por *triggers* transacionais, inclusive fora da interface.

Este é um **controle gerencial manual de saldos**, não uma integração Open Finance, não substitui demonstrações contábeis oficiais e não deve ser tratado como conciliação bancária automática.
