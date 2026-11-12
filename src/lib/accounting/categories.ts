/** Categorização de despesas da contabilidade privada Prosperity Pay. */
export const CATEGORY_OPTIONS=[
  {key:"alimentacao",label:"Alimentação",description:"Restaurantes, lanches, mercados"},
  {key:"transporte",label:"Transporte",description:"Combustível, estacionamento e corridas"},
  {key:"automovel",label:"Veículos",description:"Manutenção e acessórios automotivos"},
  {key:"moradia",label:"Moradia",description:"Aluguel, energia e contas da casa"},
  {key:"tecnologia",label:"Tecnologia",description:"Softwares, equipamentos e serviços digitais"},
  {key:"assinaturas",label:"Assinaturas",description:"Serviços recorrentes e streaming"},
  {key:"hospedagem",label:"Viagens e hospedagem",description:"Hotéis e hospedagens"},
  {key:"saude",label:"Saúde e bem-estar",description:"Farmácia, academia e saúde"},
  {key:"lazer",label:"Lazer",description:"Cinema, jogos e entretenimento"},
  {key:"vestuario",label:"Vestuário",description:"Roupas, calçados e acessórios"},
  {key:"casa",label:"Casa e utilidades",description:"Utensílios, eletrodomésticos e móveis"},
  {key:"compras",label:"Compras gerais",description:"Marketplaces e compras sem produto identificado"},
  {key:"marketing",label:"Marketing",description:"Anúncios e divulgação"},
  {key:"impostos",label:"Impostos",description:"Receita Federal, DAS e tributos"},
  {key:"taxas",label:"Taxas financeiras",description:"IOF, juros e tarifas"},
  {key:"servicos",label:"Serviços",description:"Serviços contratados"},
  {key:"educacao",label:"Educação",description:"Cursos e formação"},
  {key:"seguros",label:"Seguros",description:"Seguro de veículos ou outros riscos"},
  {key:"produto",label:"Produto",description:"Produtos e mercadorias"},
  {key:"outros",label:"Outros",description:"Despesas ainda não classificadas"},
] as const;
export type FinanceCategory = typeof CATEGORY_OPTIONS[number]["key"];
export type SummaryCategory = FinanceCategory | "ajustes";
export const CATEGORY_LABELS:Record<FinanceCategory,string> = Object.fromEntries(
 CATEGORY_OPTIONS.map(x=>[x.key,x.label])
) as Record<FinanceCategory,string>;
const allowed = new Set<string>(CATEGORY_OPTIONS.map(x=>x.key));
export function isFinanceCategory(value:unknown):value is FinanceCategory{
  return typeof value==="string"&&allowed.has(value);
}

/** Recomendação conservadora para novas despesas; classificação manual prevalece. */
export function suggestCategory(title:string):FinanceCategory{
 const s=title.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase();
 const matches:(readonly [RegExp,FinanceCategory])[]=[
  [/(IFD[*]|BURGER KING|BURGUINHO|BETINHO LANCHES|PIZZARIA|ESFIHAS|SORVETES|SOPASTEL|FAST FOOD|LANCHES|RESTAURANTE|PADARIA|SUPERMERCADO)/,"alimentacao"],
  [/(POSTO [0-9]|POSTO DE COMBUST|ESTACIONAMENTO|UBER|99POP|99 TAXI|PEDAGIO|COMBUSTIVEL)/,"transporte"],
  [/(I9 CORES AUTOMOTIVAS|AUTOPECAS|OFICINA MECAN|PNEUS|VEICULAR)/,"automovel"],
  [/(ENERGIA ELETRICA|CEMIG|COPASA|AGUA E ESGOTO|ALUGUEL|CONDOMINIO)/,"moradia"],
  [/(VERCEL|SUPABASE|OPENAI|CHATGPT|MICROSOFT|HOSTINGER|NOTEBOOK|IPHONE|CARREGADOR|CABO RCA|KIT GRAVACAO|CONTROLE)/,"tecnologia"],
  [/(SPOTIFY|AMAZON PRIME|NETFLIX|YOUTUBE PREMIUM|DISNEY[+]|HBO MAX)/,"assinaturas"],
  [/(AIRBNB|HOTEL|POUSADA|PASSAGEM AEREA|BOOKING)/,"hospedagem"],
  [/(WELLHUB|GYMPASS|FARMACIA|DROGARIA|ACADEMIA|CONSULTA MEDICA)/,"saude"],
  [/(CINEART|CINEMA|PLAY 5|PLAYSTATION|SHOW|INGRESSO)/,"lazer"],
  [/(MINIMAL BAG|CUECA|ROUPA|CALCADO|VISTACH)/,"vestuario"],
  [/(BOJO PIA|MOP|ELETRODOMESTICO|MOVEIS)/,"casa"],
  [/(MERCADOLIVRE|MERCADO LIVRE|SHOPEE|AMAZON|ISMAFER)/,"compras"],
  [/(METAPAY|FACEBK|FACEBOOK ADS|GOOGLE ADS|PUBLICIDADE)/,"marketing"],
  [/(RECEITAFEDERAL|RECEITA FEDERAL|DARF|DAS MEI|IMPOSTO)/,"impostos"],
  [/(IOF|CARTAO PROTEGIDO|TARIFA BANCARIA|JUROS)/,"taxas"],
  [/(SEGURO VEICULAR|SEGURO AUTO|SEGURADORA)/,"seguros"],
  [/(CURSO|FACULDADE|LIVRO DIDATICO|ESCOLA|COLEGIO)/,"educacao"],
  [/(PRESTACAO DE SERVICO|MANUTENCAO|LAVANDERIA)/,"servicos"],
 ];
 return matches.find(([regex])=>regex.test(s))?.[1]??"outros";
}

export type CategoryExpense={
 category:string;kind:string;box_id:string;
 competence_month:string;amount_cents:number;
};
export type CategoryAdjustment={
 box_id:string;invoice_month:string;kind:"credit"|"debit";amount_cents:number;
};
export type CategoryTotals = {
 category:SummaryCategory;
 label:string;
 amountCents:number;
 count:number;
 percent:number;
};
export function summarizeCategories(
 entries:readonly CategoryExpense[],
 adjustments:readonly CategoryAdjustment[],
 month:string,
 boxId="",
){
 const target=month+"-01";
 const groups=new Map<SummaryCategory,{amountCents:number;count:number}>();
 for(const e of entries){
  if(e.kind!=="expense"||e.competence_month!==target)continue;
  if(boxId&&e.box_id!==boxId)continue;
  const key=isFinanceCategory(e.category)?e.category:"outros";
  const g=groups.get(key)??{amountCents:0,count:0};
  g.amountCents+=e.amount_cents;g.count++;
  groups.set(key,g);
 }
 let adjustmentsCents=0;
 for(const a of adjustments){
  if(a.invoice_month!==target||(boxId&&a.box_id!==boxId))continue;
  adjustmentsCents+=a.kind==="credit"?-a.amount_cents:a.amount_cents;
 }
 if(adjustmentsCents!==0)groups.set("ajustes",{amountCents:adjustmentsCents,count:0});
 const grossCents=[...groups.entries()]
  .filter(([k])=>k!=="ajustes").reduce((sum,[,v])=>sum+v.amountCents,0);
 const totals:CategoryTotals[]=[...groups.entries()].map(([key,v])=>({
  category:key,label:key==="ajustes"?"Créditos e ajustes":CATEGORY_LABELS[key],
  amountCents:v.amountCents,count:v.count,
  percent:grossCents>0&&key!=="ajustes"?v.amountCents/grossCents*100:0,
 })).sort((a,b)=>b.amountCents-a.amountCents||a.label.localeCompare(b.label,"pt-BR"));
 return {items:totals,grossCents,adjustmentsCents,netCents:grossCents+adjustmentsCents,
  count:totals.reduce((n,item)=>n+item.count,0),categories:totals.filter(g=>g.category!=="ajustes").length};
}
