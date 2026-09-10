function readOptional(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

export const env = {
  appUrl: readOptional("NEXT_PUBLIC_APP_URL"),
  supabaseUrl: readOptional("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: readOptional("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: readOptional("SUPABASE_SERVICE_ROLE_KEY"),
  mercadoPagoAccessToken: readOptional("MERCADO_PAGO_ACCESS_TOKEN"),
  mercadoPagoWebhookSecret: readOptional("MERCADO_PAGO_WEBHOOK_SECRET"),
};

export function requireEnv(value: string | undefined, name: string) {
  if (!value) {
    throw new Error(`Variavel de ambiente obrigatoria ausente: ${name}`);
  }

  return value;
}
