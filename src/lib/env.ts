function readOptional(value: string | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

export const env = {
  appUrl: readOptional(process.env.NEXT_PUBLIC_APP_URL),
  supabaseUrl: readOptional(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: readOptional(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseServiceRoleKey: readOptional(process.env.SUPABASE_SERVICE_ROLE_KEY),
  supabaseSecretKey: readOptional(process.env.SUPABASE_SECRET_KEY),
  mercadoPagoPublicKey: readOptional(process.env.NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY),
  mercadoPagoAccessToken: readOptional(process.env.MERCADO_PAGO_ACCESS_TOKEN),
  mercadoPagoWebhookSecret: readOptional(process.env.MERCADO_PAGO_WEBHOOK_SECRET),
  mercadoPagoClientId: readOptional(process.env.MERCADO_PAGO_CLIENT_ID),
  mercadoPagoClientSecret: readOptional(process.env.MERCADO_PAGO_CLIENT_SECRET),
  mercadoPagoRedirectUri: readOptional(process.env.MERCADO_PAGO_REDIRECT_URI),
  financialEncryptionKey: readOptional(process.env.FINANCIAL_ENCRYPTION_KEY),
};

export function requireEnv(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }

  return value;
}
