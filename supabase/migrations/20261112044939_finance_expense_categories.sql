-- Categorias das contas financeiras: somente despesas, sem reclassificar caixa,
-- cartão, valor, situação, competência ou lançamento bancário.
alter table public.finance_entries
 add column if not exists category text not null default 'outros';

alter table public.finance_entries
 add constraint finance_entries_category_check
 check (category in (
   'alimentacao','transporte','automovel','moradia','tecnologia',
   'assinaturas','hospedagem','saude','lazer','vestuario',
   'casa','compras','marketing','impostos','taxas',
   'servicos','educacao','seguros','outros'
 ));

create index if not exists finance_entries_category_month_box_idx
 on public.finance_entries(owner_user_id,competence_month,box_id,category)
 where kind='expense';

-- Classificação inicial conservadora pelo nome cadastrado; títulos ambíguos
-- ficam como compras gerais ou outros para revisão manual pelo responsável.
update public.finance_entries
set category = case
  when title ~* '(IFD[*]|BURGER KING|BURGUINHO|BETINHO LANCHES|PIZZARIA|ESFIHAS|SORVETES|SOPASTEL|FAST FOOD|LANCHES|RESTAURANTE|PADARIA|MERCADO ALIMENT|SUPERMERCADO)' then 'alimentacao'
  when title ~* '(POSTO [0-9]|POSTO DE COMBUST|ESTACIONAMENTO|UBER|99POP|99 TAXI|PEDAGIO|COMBUSTIVEL)' then 'transporte'
  when title ~* '(I9 CORES AUTOMOTIVAS|AUTOPECAS|OFICINA MECAN|PNEUS|VEICULAR)' then 'automovel'
  when title ~* '(ENERGIA ELETRICA|CEMIG|COPASA|AGUA E ESGOTO|ALUGUEL|CONDOMINIO)' then 'moradia'
  when title ~* '(VERCEL|SUPABASE|OPENAI|CHATGPT|MICROSOFT|HOSTINGER|NOTEBOOK|IPHONE|CARREGADOR|CABO RCA|KIT GRAVACAO|CONTROLE)' then 'tecnologia'
  when title ~* '(SPOTIFY|AMAZON PRIME|NETFLIX|YOUTUBE PREMIUM|DISNEY[+]|HBO MAX)' then 'assinaturas'
  when title ~* '(AIRBNB|HOTEL|POUSADA|PASSAGEM AEREA|BOOKING)' then 'hospedagem'
  when title ~* '(WELLHUB|GYMPASS|FARMACIA|DROGARIA|ACADEMIA|CONSULTA MEDICA)' then 'saude'
  when title ~* '(CINEART|CINEMA|PLAY 5|PLAYSTATION|SHOW|INGRESSO)' then 'lazer'
  when title ~* '(MINIMAL BAG|CUECA|ROUPA|CALCADO|VISTACH)' then 'vestuario'
  when title ~* '(BOJO PIA|MOP|ELETRODOMESTICO|MOVEIS)' then 'casa'
  when title ~* '(MERCADOLIVRE|MERCADO LIVRE|SHOPEE|AMAZON|ISMAFER)' then 'compras'
  when title ~* '(METAPAY|FACEBK|FACEBOOK ADS|GOOGLE ADS|PUBLICIDADE)' then 'marketing'
  when title ~* '(RECEITAFEDERAL|RECEITA FEDERAL|DARF|DAS MEI|IMPOSTO)' then 'impostos'
  when title ~* '(IOF|CARTAO PROTEGIDO|TARIFA BANCARIA|JUROS)' then 'taxas'
  when title ~* '(SEGURO VEICULAR|SEGURO AUTO|SEGURADORA)' then 'seguros'
  when title ~* '(CURSO|FACULDADE|LIVRO DIDATICO|ESCOLA|COLEGIO)' then 'educacao'
  when title ~* '(PRESTACAO DE SERVICO|MANUTENCAO|LAVANDERIA)' then 'servicos'
  else 'outros'
end
where kind='expense' and category='outros';
