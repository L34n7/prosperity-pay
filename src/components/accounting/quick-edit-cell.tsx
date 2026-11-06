"use client";

import { useEffect, useState } from "react";
import styles from "./accounting-view.module.css";

type SelectOption = { value: string; label: string; disabled?: boolean };
type Common = { label: string; disabled: boolean; saving: boolean; onCommit(value: string): Promise<boolean> };

export function QuickSelectCell({value, options, label, disabled, saving, onCommit, onCreate}: Common & {
  value:string;options:SelectOption[];onCreate?:()=>void;
}) {
  const [draft,setDraft]=useState(value);
  useEffect(()=>setDraft(value),[value]);
  return <select className={styles.quickSelect} aria-label={label}
    title={label} disabled={disabled||saving} value={draft}
    onChange={async e=>{
      const next=e.target.value;
      if(next==="__new__"){onCreate?.();return;}
      if(next===value)return;
      setDraft(next);
      const ok=await onCommit(next);
      if(!ok)setDraft(value);
    }}>
    {options.map(opt=><option value={opt.value} key={opt.value} disabled={opt.disabled}>{opt.label}</option>)}
  </select>;
}

export function QuickInputCell({value,label,disabled,saving,onCommit,type="text",min,step,inputMode}:Common & {
  value:string;type?:"text"|"number"|"date";min?:string;step?:string;inputMode?:"decimal"|"text";
}) {
  const [draft,setDraft]=useState(value);
  useEffect(()=>setDraft(value),[value]);
  return <input className={styles.quickInput} aria-label={label}
    title="Alterar e sair do campo para salvar automaticamente" disabled={disabled||saving}
    value={draft} type={type} min={min} step={step} inputMode={inputMode}
    onChange={e=>setDraft(e.target.value)}
    onKeyDown={e=>{
      if(e.key==="Enter"){e.preventDefault();e.currentTarget.blur();}
      if(e.key==="Escape"){setDraft(value);e.currentTarget.blur();}
    }}
    onBlur={async()=>{
      const next=draft.trim();
      if(next===value)return;
      const ok=await onCommit(next);
      if(!ok)setDraft(value);
    }}
  />;
}
