import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, Info } from "lucide-react";

type StatCardProps = {
  title: string;
  value: string;
  change: number;
  icon: LucideIcon;
  description: string;
  accent?: "emerald" | "gold";
};

export function StatCard({ title, value, change, icon: Icon, description, accent = "emerald" }: StatCardProps) {
  const positive = change >= 0;

  return (
    <article className={`stat-card accent-${accent}`}>
      <div className="stat-card-top">
        <span className="stat-icon"><Icon size={19} /></span>
        <span className="tooltip-wrap">
          <button className="info-button" aria-label={`Entenda ${title}`}><Info size={15} /></button>
          <span className="tooltip">{description}</span>
        </span>
      </div>
      <p>{title}</p>
      <strong>{value}</strong>
      <div className={`stat-change${positive ? " positive" : " negative"}`}>
        {positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        <b>{Math.abs(change).toLocaleString("pt-BR")}%</b>
        <span>vs. período anterior</span>
      </div>
    </article>
  );
}
