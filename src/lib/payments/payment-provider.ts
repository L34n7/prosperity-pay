import type {
  CreatePaymentInput,
  ProviderPayment,
  RefundPaymentInput,
} from "./types";

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  getPayment(externalPaymentId: string): Promise<ProviderPayment>;
  refundPayment(input: RefundPaymentInput): Promise<ProviderPayment>;
}
