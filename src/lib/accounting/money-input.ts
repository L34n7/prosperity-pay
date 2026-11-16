/** Formatação centesimal automática para campos em reais (pt-BR).
 * Digitação estilo calculadora: 1 → 0,01; 1234 → 12,34; 121809 → 1.218,09.
 * Nunca usa número de ponto flutuante para interpretar o valor.
 */
const MAX_DIGITS=12;
export function formatMoneyInput(raw:string):string {
 const digits=raw.replace(/\D/g,"").slice(0,MAX_DIGITS);
 if(!digits)return "";
 const cents=Number(digits);
 return (cents/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
}
export function moneyInputFromCents(cents:number):string{
 if(!Number.isSafeInteger(cents)||cents<0)return "";
 return (cents/100).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
}
export function moneyInputToCents(text:string):number{
 const cleaned=text.trim();
 if(!cleaned||!/^[\d.,\s]+$/.test(cleaned))return 0;
 const digits=cleaned.replace(/\D/g,"");
 if(!digits||digits.length>MAX_DIGITS)return 0;
 const cents=Number(digits);
 return Number.isSafeInteger(cents)&&cents>0 ? cents : 0;
}
