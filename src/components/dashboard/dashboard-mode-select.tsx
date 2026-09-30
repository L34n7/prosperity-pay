"use client";

import { ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";

export function DashboardModeSelect({
  mode,
  hasProducer,
  hasPartner,
}: {
  mode: "producer" | "partner";
  hasProducer: boolean;
  hasPartner: boolean;
}) {
  const router = useRouter();

  return (
    <label className="dashboard-mode-control">
      <span>Visão</span>
      <span className="select-field">
        <select
          value={mode}
          onChange={(event) =>
            router.push(`/dashboard?view=${event.target.value}`)
          }
          aria-label="Selecionar visão do dashboard"
        >
          {hasProducer && <option value="producer">Produtor</option>}
          {hasPartner && <option value="partner">Parceiro</option>}
          {!hasProducer && !hasPartner && <option value="producer">Produtor</option>}
        </select>
        <ChevronDown size={15} />
      </span>
    </label>
  );
}
