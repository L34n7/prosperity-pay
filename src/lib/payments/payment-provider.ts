import type {
  CreateCheckoutInput,
  CreatePaymentInput,
  CreateSubscriptionInput,
  CreateSubscriptionPlanInput,
  ProviderAuthorizedPayment,
  ProviderCheckout,
  ProviderPayment,
  ProviderSubscription,
  ProviderSubscriptionPlan,
  RefundPaymentInput,
} from "./types";

export interface PaymentProvider {
  createCheckout(input: CreateCheckoutInput): Promise<ProviderCheckout>;
  createPayment(input: CreatePaymentInput): Promise<ProviderPayment>;
  getPayment(externalPaymentId: string): Promise<ProviderPayment>;
  refundPayment(input: RefundPaymentInput): Promise<ProviderPayment>;
  createSubscription(input: CreateSubscriptionInput): Promise<ProviderSubscription>;
  createSubscriptionPlan(input: CreateSubscriptionPlanInput): Promise<ProviderSubscriptionPlan>;
  getSubscriptionPlan(externalPlanId: string): Promise<ProviderSubscriptionPlan>;
  getSubscription(externalSubscriptionId: string): Promise<ProviderSubscription>;
  updateSubscriptionAmount(externalSubscriptionId: string, amount: number, currency?: "BRL"): Promise<ProviderSubscription>;
  getAuthorizedPayment(externalAuthorizedPaymentId: string): Promise<ProviderAuthorizedPayment>;
}
