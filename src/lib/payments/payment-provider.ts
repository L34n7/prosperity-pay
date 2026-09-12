import type {
  CreateCheckoutInput,
  CreatePaymentInput,
  ProviderCheckout,
  ProviderPayment,
  RefundPaymentInput,
} from "./types";

export interface PaymentProvider {
  createCheckout(input: CreateCheckoutInput): Promise<ProviderCheckout>;
  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  getPayment(externalPaymentId: string): Promise<ProviderPayment>;
  refundPayment(input: RefundPaymentInput): Promise<ProviderPayment>;
}
