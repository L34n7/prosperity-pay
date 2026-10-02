create table if not exists public.integration_checkout_prefill_sessions (
  id uuid primary key default gen_random_uuid(),
  integration_key text not null,
  token_hash text not null unique,
  offer_slug text not null,
  customer_name text not null,
  customer_email text not null,
  affiliate_ref text,
  source_reference text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists integration_checkout_prefill_sessions_expires_at_idx
  on public.integration_checkout_prefill_sessions (expires_at);

alter table public.integration_checkout_prefill_sessions enable row level security;

revoke all on table public.integration_checkout_prefill_sessions from anon, authenticated;
grant select, insert, update, delete on table public.integration_checkout_prefill_sessions to service_role;
