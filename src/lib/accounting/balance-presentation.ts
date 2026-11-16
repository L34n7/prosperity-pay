/** Apresentação contábil dos saldos por banco dentro de cada caixa.
 * Saldo líquido pode compensar instituições com déficit e não corresponde,
 * necessariamente, ao valor efetivamente depositado em um banco específico.
 */
export type BankAllocation={bankId:string;bankName:string;cents:number};
export type BoxBankAllocation={
 boxId:string;boxName:string;netCents:number;positiveCents:number;deficitCents:number;
 hasCrossBankDeficit:boolean;banks:BankAllocation[];
};
export function summarizeBankAllocations(
 banks:readonly {id:string;name:string}[],
 boxes:readonly {id:string;name:string}[],
 matrix:Readonly<Record<string,number>>,
):BoxBankAllocation[]{
 return boxes.map(box=>{
  const items=banks.map(bank=>({
   bankId:bank.id,bankName:bank.name,cents:matrix[bank.id+":"+box.id]??0,
  })).filter(item=>item.cents!==0);
  const positiveCents=items.reduce((sum,item)=>sum+Math.max(item.cents,0),0);
  const deficitCents=items.reduce((sum,item)=>sum+Math.max(-item.cents,0),0);
  return {boxId:box.id,boxName:box.name,netCents:positiveCents-deficitCents,
   positiveCents,deficitCents,hasCrossBankDeficit:positiveCents>0&&deficitCents>0,
   banks:items.sort((a,b)=>b.cents-a.cents||a.bankName.localeCompare(b.bankName,"pt-BR"))};
 });
}
