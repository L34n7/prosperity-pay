begin;

create extension if not exists pgcrypto;

create type public.payment_status as enum (
  'pending',
  'processing',
  'approved',
  'rejected',
  'cancelled',
  'refunded',
  'charged_back'
);

create type public.subscription_status as enum (
  'pending',
  'active',
  'past_due',
  'paused',
  'cancelled',
  'expired'
);

create type public.commission_status as enum (
  'pending',
  'available',
  'paid',
  'cancelled',
  'reversed'
);

create type public.payout_status as enum (
  'pending',
  'processing',
  'paid',
  'failed',
  'cancelled'
);

create table public.payment_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  external_customer_id text,
  name text,
  email text,
  document text,
  phone text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index customers_external_customer_id_uq
  on public.customers (external_customer_id)
  where external_customer_id is not null;

create table public.affiliate_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  email text,
  document text,
  pix_key text,
  status text not null default 'active' check (status in ('active', 'inactive', 'blocked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.affiliate_links (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts(id) on delete cascade,
  ref_code text not null unique,
  campaign text,
  destination_path text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.affiliate_attributions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts(id),
  affiliate_link_id uuid references public.affiliate_links(id),
  customer_id uuid references public.customers(id),
  ref_code text not null,
  campaign text,
  session_key text,
  attributed_at timestamptz not null default now(),
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create index affiliate_attributions_customer_idx on public.affiliate_attributions(customer_id);
create index affiliate_attributions_ref_idx on public.affiliate_attributions(ref_code);

create table public.affiliate_commission_rules (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid references public.affiliate_accounts(id) on delete cascade,
  plan_slug text,
  rule_type text not null check (rule_type in ('percentage', 'fixed')),
  value numeric(14,2) not null check (value >= 0),
  recurrence_mode text not null default 'first_payment'
    check (recurrence_mode in ('first_payment', 'limited_recurring', 'lifetime_recurring')),
  recurrence_cycles integer check (recurrence_cycles is null or recurrence_cycles > 0),
  hold_days integer not null default 7 check (hold_days >= 0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id),
  provider_id uuid references public.payment_providers(id),
  external_subscription_id text,
  plan_slug text not null,
  status public.subscription_status not null default 'pending',
  amount numeric(14,2) not null check (amount >= 0),
  currency char(3) not null default 'BRL',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index subscriptions_provider_external_uq
  on public.subscriptions(provider_id, external_subscription_id)
  where external_subscription_id is not null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id),
  subscription_id uuid references public.subscriptions(id),
  affiliate_attribution_id uuid references public.affiliate_attributions(id),
  provider_id uuid not null references public.payment_providers(id),
  external_payment_id text,
  external_reference text not null unique,
  idempotency_key text not null unique,
  status public.payment_status not null default 'pending',
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  provider_fee_amount numeric(14,2) not null default 0 check (provider_fee_amount >= 0),
  net_amount numeric(14,2) generated always as (gross_amount - provider_fee_amount) stored,
  currency char(3) not null default 'BRL',
  paid_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index payments_provider_external_uq
  on public.payments(provider_id, external_payment_id)
  where external_payment_id is not null;
create index payments_subscription_idx on public.payments(subscription_id);
create index payments_status_idx on public.payments(status);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  provider_event_id text,
  transaction_type text not null,
  amount numeric(14,2),
  status text,
  raw_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  created_at timestamptz not null default now()
);

create index payment_transactions_payment_idx on public.payment_transactions(payment_id);

create table public.affiliate_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts(id),
  payment_id uuid not null references public.payments(id),
  commission_rule_id uuid references public.affiliate_commission_rules(id),
  status public.commission_status not null default 'pending',
  base_amount numeric(14,2) not null check (base_amount >= 0),
  commission_amount numeric(14,2) not null check (commission_amount >= 0),
  available_at timestamptz,
  paid_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (affiliate_id, payment_id)
);

create index affiliate_commissions_status_idx on public.affiliate_commissions(status);
create index affiliate_commissions_affiliate_idx on public.affiliate_commissions(affiliate_id);

create table public.affiliate_payouts (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts(id),
  status public.payout_status not null default 'pending',
  amount numeric(14,2) not null check (amount > 0),
  pix_key_snapshot text,
  external_payout_id text,
  paid_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.affiliate_payout_items (
  payout_id uuid not null references public.affiliate_payouts(id) on delete cascade,
  commission_id uuid not null unique references public.affiliate_commissions(id),
  amount numeric(14,2) not null check (amount > 0),
  primary key (payout_id, commission_id)
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.payment_providers(id),
  external_event_id text,
  event_type text,
  payload_hash text,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'ignored', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index webhook_events_provider_external_uq
  on public.webhook_events(provider_id, external_event_id)
  where external_event_id is not null;
create unique index webhook_events_provider_hash_uq
  on public.webhook_events(provider_id, payload_hash)
  where payload_hash is not null;
create index webhook_events_status_idx on public.webhook_events(status, created_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger payment_providers_set_updated_at before update on public.payment_providers for each row execute function public.set_updated_at();
create trigger customers_set_updated_at before update on public.customers for each row execute function public.set_updated_at();
create trigger affiliate_accounts_set_updated_at before update on public.affiliate_accounts for each row execute function public.set_updated_at();
create trigger affiliate_links_set_updated_at before update on public.affiliate_links for each row execute function public.set_updated_at();
create trigger affiliate_commission_rules_set_updated_at before update on public.affiliate_commission_rules for each row execute function public.set_updated_at();
create trigger subscriptions_set_updated_at before update on public.subscriptions for each row execute function public.set_updated_at();
create trigger payments_set_updated_at before update on public.payments for each row execute function public.set_updated_at();
create trigger affiliate_commissions_set_updated_at before update on public.affiliate_commissions for each row execute function public.set_updated_at();
create trigger affiliate_payouts_set_updated_at before update on public.affiliate_payouts for each row execute function public.set_updated_at();

insert into public.payment_providers (code, name)
values ('mercadopago', 'Mercado Pago')
on conflict (code) do nothing;

alter table public.payment_providers enable row level security;
alter table public.customers enable row level security;
alter table public.affiliate_accounts enable row level security;
alter table public.affiliate_links enable row level security;
alter table public.affiliate_attributions enable row level security;
alter table public.affiliate_commission_rules enable row level security;
alter table public.subscriptions enable row level security;
alter table public.payments enable row level security;
alter table public.payment_transactions enable row level security;
alter table public.affiliate_commissions enable row level security;
alter table public.affiliate_payouts enable row level security;
alter table public.affiliate_payout_items enable row level security;
alter table public.webhook_events enable row level security;

commit;
