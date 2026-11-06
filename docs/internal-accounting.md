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


## Fluxo de caixa projetado e cartões (novembro de 2026)

A navegação começa em **Fluxo de caixa** e inclui **Planilha de contas**, **Faturas de cartões**, **Saldos por banco e caixa** e **Entradas e transferências**. O filtro de competência continua disponível, mas a projeção sempre parte do dia real corrente, em horário de São Paulo.

### Duas camadas de dinheiro
- **Saldo real:** entradas e aportes efetivados, transferências reais entre bancos/caixas, pagamentos diretos, recebimentos previstos confirmados e pagamentos de fatura registrados.
- **Saldo projetado:** saldo real + recebimentos previstos (ainda não realizados) − contas bancárias pendentes − faturas líquidas por vencer. Mostrar projeção não registra dinheiro no banco; previsões em atraso aparecem no dia de hoje com aviso. A previsão pode ser vista por banco, por caixa e em horizontes de 15/30/60/90/120 dias.
- Alertas de insuficiência devem ser interpretados **por caixa**. Dinheiro reservado a Lucas ou Leandro não é disponível para pagamentos do CRM; para alterar titularidade, registre uma transferência real e documentada.

### Cartões não são contas bancárias

Os cartões **Inter, Mercado Pago, Carrefour, Sicredi e Bradesco** possuem cadastro e vencimento independentes (7, 9, 10, 5, 10, respectivamente). Inter e Mercado Pago são também bancos reais ativos, mas seus cartões ficam em outra entidade. Os pseudo-bancos legados dos cartões permanecem arquivados somente para integridade das referências antigas, sem aparecer como bancos reais disponíveis na grade de saldos.

Os 138 lançamentos já importados foram associados a seus respectivos cartões via `finance_entries.card_id` sem apagar dados ou gerar saídas de caixa. As compras continuam pendentes enquanto obrigações; elas não podem ser marcadas como pagas individualmente. A **fatura** agrupa compras por cartão, mês e caixa, admite créditos e débitos de ajuste, e um ou mais pagamentos parciais, que são os únicos débitos efetivos da conta bancária. É possível pagar com Inter ou Mercado Pago e escolher o caixa dono da obrigação. Um pagamento de fatura recebe token de idempotência, é protegido por competência fechada e não pode ultrapassar o saldo da fatura do caixa. Para corrigir pagamento, use **Estornar** e registre o correto; a operação original deixa de abater o banco.

A fatura de novembro do cartão Inter possui R$ 3.037,26 em compras e R$ 503,76 em créditos/abatimentos, portanto projeção líquida de R$ 2.533,50, antes de pagamentos posteriores. O extrato Bradesco estava em aberto; não presumir que o valor dos lançamentos detalhados corresponda ao total final.

**Ponto de atenção:** o caixa de todas as compras importadas ainda foi atribuído provisoriamente a *Leandro*. Ajuste compras/parcelas para CRM ou outros caixas antes de registrar pagamentos. Os ajustes de fatura também são associados a um caixa e devem acompanhar a classificação correta da obrigação. Para mudar caixa/valor/mês de compras após pagamentos de fatura, primeiro estorne os pagamentos que dependem daquele agrupamento.

### Recebimentos previstos

Cadastre **título, valor, data esperada, banco e caixa**. Na aba de fluxo, aparecem como entrada **prevista**, mas não afetam o saldo disponível. Clique **Confirmar entrada** quando o dinheiro for de fato recebido, informando data/hora reais; o registro passa a ser receita confirmada e sai da previsão. Não deve ser recadastrado também como uma entrada manual. É possível editar/cancelar previsões não realizadas e excluir registros quando o mês está aberto. Na aba **Entradas e transferências**, os recebimentos previstos já confirmados e os pagamentos efetivos das faturas entram no histórico de caixa.

### Fechamento e integridade

A competência do relatório de contas continua sendo o mês do vencimento (passivo), e a baixa bancária real pertence à data do pagamento. Uma fatura pode permanecer em aberto ao fechar um mês, pois não é caixa gasto, mas uma conta a pagar. O fechamento bloqueia alterações retroativas em compras, ajustes, previsões e pagamentos efetivados em período encerrado; pagamentos de faturas antigas continuam possíveis num mês atual aberto. Tabelas criadas/alteradas: `finance_cards`, `finance_entries.card_id`, `finance_card_payments`, `finance_card_adjustments`, `finance_expected_incomes`, com RLS de proprietário e administrador e validação de consistência em gatilhos PostgreSQL.

Não há integração automática com extratos nem envio de Pix: toda movimentação confirmada é um registro manual, a ser conciliado com o aplicativo bancário.


## Planilha editável e saídas bancárias avulsas (novembro/2026)

A aba **Planilha de contas** tem botão **Habilitar edição / Concluir edição** no cabeçalho. Ao ativá-lo, cada linha de conta pode ser modificada diretamente: descrição, origem (select com "Sem origem" e atalho "+ Nova origem"), banco ou cartão, caixa, vencimento, situação da conta bancária e valor. Em cada seleção o sistema salva automaticamente; para texto, valor e data, salva ao perder foco ou pressionar Enter. A tecla Esc desfaz um texto ainda não salvo. Sinais **Salvando** e **Salvo** indicam o resultado; erro de validação mantém o dado anterior e exibe uma mensagem. A API PATCH com action=quick_entry aceita um único campo e updatedAt, verificando versão para não sobrescrever edição concorrente. Os outros campos não são regravados.

**Limitações necessárias:** número de parcela e total do grupo não são alterados na célula, pois representam o vínculo entre parcelas. Compra de cartão nunca é paga individualmente; pagamentos ficam na aba Faturas. O select de situação permite marcar despesas bancárias como pagas na data e hora atuais (com confirmação), mas o modal completo permite especificar outras datas. Meses fechados ficam somente para leitura. Cada edição de conta parcelada modifica somente uma parcela.

O lançamento **Pix enviado Durval Miranda – R$ 11,00**, já pago pelo Inter/CRM em novembro de 2026, foi reclassificado de expense para **outflow (saída bancária avulsa)**. Não pertence à planilha de contas nem à previsão de contas a pagar; aparece em **Movimentações bancárias**, preservando data, caixa, banco, valor e efeito negativo no saldo. A tela oferece botão **Saída / Pix** para outros débitos avulsos, sem criar obrigação futura. O resumo apresenta despesas pagas e saídas avulsas separadamente.


## Relatório Movimentações (novembro de 2026)

A aba antiga **Entradas e transferências** passa a se chamar **Movimentações** e apresenta o extrato de banco completo: entradas recebidas, saídas/Pix, pagamentos avulsos, transferências entre bancos/caixas, saldos iniciais/aportes, despesas bancárias pagas e pagamentos de fatura. Os dados são reunidos a partir de lançamentos bancários efetivos, registros de pagamento de fatura e recebimentos previstos que já foram confirmados. **Compras de cartão, parcelas futuras e recebimentos não confirmados não são movimentações do banco.** Cada transferência entre bancos aparece em uma só linha, com origem e destino; ao filtrar por banco/caixa o saldo assinado reflete o lado selecionado. No consolidado as transferências internas têm efeito líquido zero.

Por padrão o relatório abre nos **últimos 60 dias**, incluindo transações recentes de outubro e novembro, independentemente da competência escolhida para a planilha. Há filtros por período (últimos 30/60/90 dias, mês atual, anterior, histórico completo ou datas personalizadas), tipo (todas, apenas entradas, apenas saídas/Pix, apenas transferências, saldos/aportes, pagamentos de contas e faturas), banco, caixa e texto; resultados com 40 linhas iniciais, botão Mostrar mais e exportação CSV dos registros filtrados. A data considerada é a efetiva do lançamento, não a de criação do cadastro. Horários ausentes em extratos importados não são apresentados como horários reais.

### Conciliação das entradas de outubro

A parte de R$83,34 do Pix Jefferson Eugênio (antigo título "parte CRM") passou para o caixa **Leandro**, com título corrigido. O Pix de R$450,00 de Ministério Unido Casa de Deus também foi realocado para Leandro. Os R$266,66 de Jefferson atribuídos a Lucas permanecem com Lucas. O saldo bancário agregado não se altera: apenas a repartição por caixa foi modificada.

Outros 25 pagamentos e Pix oriundos dos extratos bancários de outubro, anteriormente registrados como despesas pagas, foram reclassificados em **outflow**. Junto ao Pix Durval Miranda, são 26 saídas avulsas que diminuem saldo bancário mas não aparecem como contas na planilha. As 138 contas/parcelas de cartões são preservadas e continuam na Planilha de contas/Faturas. Para pagamentos avulsos futuros, utilize **Movimentações > Saída / Pix**, não "Adicionar conta".
