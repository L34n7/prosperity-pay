import type { PaymentProvider } from "./payment-provider";
import type { PaymentProviderCode } from "./types";
import { MercadoPagoProvider } from "./providers/mercadopago/mercado-pago-provider";

export function getPaymentProvider(code: PaymentProviderCode, accessToken?: string): PaymentProvider {
  switch (code) {
    case "mercadopago":
      return new MercadoPagoProvider(accessToken);
    default: {
      const exhaustive: never = code;
      throw new Error(`Provedor de pagamento nao suportado: ${exhaustive}`);
    }
  }
}
