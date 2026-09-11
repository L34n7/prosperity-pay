import type { PaymentStatus } from "@/lib/payments";

export type PaymentMethod = "PIX" | "Cartão";

export type Payment = {
  id: string;
  customer: string;
  email: string;
  amount: number;
  providerFee: number;
  commission: number;
  method: PaymentMethod;
  provider: "Mercado Pago";
  affiliate: string | null;
  status: PaymentStatus;
  externalId: string;
  createdAt: string;
};

export type Affiliate = {
  id: string;
  name: string;
  email: string;
  document: string;
  pixKey: string;
  code: string;
  commissionRule: string;
  sales: number;
  volume: number;
  pendingCommission: number;
  availableCommission: number;
  paidCommission: number;
  active: boolean;
};

export type CommissionStatus = "pending" | "available" | "paid" | "cancelled" | "reversed";

export type Commission = {
  id: string;
  saleId: string;
  affiliate: string;
  saleAmount: number;
  rule: string;
  amount: number;
  availableAt: string;
  status: CommissionStatus;
};
