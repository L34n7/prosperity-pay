import type { CommissionStatus } from "@/lib/dashboard/types";
import type { PaymentStatus } from "@/lib/payments";

type Status = PaymentStatus | CommissionStatus | "active" | "inactive";

const statusLabels: Record<Status, string> = {
  approved: "Aprovado",
  pending: "Pendente",
  processing: "Processando",
  rejected: "Falhou",
  cancelled: "Cancelado",
  refunded: "Estornado",
  charged_back: "Chargeback",
  available: "Disponível",
  paid: "Paga",
  reversed: "Estornada",
  active: "Ativo",
  inactive: "Inativo",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`status-badge status-${status}`}>
      <span aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}
