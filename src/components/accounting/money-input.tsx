"use client";

import type { ComponentPropsWithoutRef } from "react";
import { formatMoneyInput } from "@/lib/accounting/money-input";

type Props=Omit<ComponentPropsWithoutRef<"input">,"value"|"onChange"|"type"|"inputMode"> & {
 value:string;onChange(value:string):void;
};

/** Digitação de reais com centavos automáticos, sem passo inválido do input number. */
export function MoneyInput({value,onChange,...props}:Props){
 return <input {...props} type="text" inputMode="numeric"
   autoComplete="off" value={value} placeholder={props.placeholder??"0,00"}
   onChange={event=>onChange(formatMoneyInput(event.target.value))}/>;
}
