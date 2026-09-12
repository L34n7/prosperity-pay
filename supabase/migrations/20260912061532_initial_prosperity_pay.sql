begin;

create extension if not exists pgcrypto;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.app_role as enum ('admin', 'finance_operator');
create type public.settlement_model as enum ('connected_account', 'prosperity_balance');
create type public.record_status as enum ('draft', 'active', 'inactive', 'archived');
create type public.billing_type as enum ('one_time', 'recurring');
create type public.fee_type as enum ('percentage', 'fixed', 'hybrid');
create type public.invitation_status as enum ('pending', 'accepted', 'rejected', 'expired', 'cancelled');
create type public.affiliate_program_mode as enum ('public', 'approval', 'invite');
create type public.membership_status as enum ('pending', 'active', 'rejected', 'blocked', 'cancelled');
create type public.recurrence_mode as enum ('first_payment', 'limited_recurring', 'lifetime_recurring');
create type public.order_status as enum ('draft', 'pending_payment', 'paid', 'cancelled', 'expired', 'refunded', 'charged_back');
create type public.payment_status as enum ('pending', 'processing', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back');
create type public.subscription_status as enum ('pending', 'active', 'past_due', 'paused', 'cancelled', 'expired');
create type public.allocation_type as enum ('producer', 'affiliate', 'coproducer', 'prosperity_fee', 'gateway_fee');
create type public.allocation_destination as enum ('internal_balance', 'connected_account', 'platform_revenue', 'gateway');
create type public.commission_status as enum ('pending', 'available', 'paid', 'cancelled', 'reversed');
create type public.ledger_account_type as enum ('user_balance', 'platform_revenue', 'gateway_expense');
create type public.ledger_entry_type as enum ('sale_credit', 'affiliate_commission', 'coproducer_commission', 'prosperity_fee', 'gateway_fee', 'refund', 'chargeback', 'withdrawal', 'adjustment');
create type public.ledger_entry_status as enum ('posted', 'voided');
create type public.identity_verification_status as enum ('not_submitted', 'under_review', 'approved', 'rejected', 'resubmission_required');
create type public.payout_account_type as enum ('cpf', 'cnpj', 'email', 'phone', 'random_key');
create type public.payout_account_status as enum ('pending', 'verified', 'rejected', 'disabled');
create type public.withdrawal_status as enum ('requested', 'processing', 'paid', 'rejected', 'cancelled', 'failed');
create type public.refund_status as enum ('pending', 'processing', 'succeeded', 'failed', 'cancelled');
create type public.dispute_status as enum ('opened', 'under_review', 'won', 'lost', 'closed');
create type public.webhook_event_status as enum ('pending', 'processing', 'processed', 'ignored', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 160),
  email text not null,
  default_settlement_model public.settlement_model,
  locale text not null default 'pt-BR',
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_lower_uq on public.profiles (lower(email));

create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.identity_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  person_type text not null check (person_type in ('individual', 'business')),
  legal_name text not null,
  tax_id_last4 char(4) not null,
  tax_id_hash text not null,
  birth_date date,
  business_name text,
  status public.identity_verification_status not null default 'under_review',
  reviewer_id uuid references public.profiles(id),
  review_note text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((person_type = 'individual' and birth_date is not null) or person_type = 'business')
);
create unique index identity_verifications_active_uq on public.identity_verifications(user_id)
  where status in ('under_review', 'approved');

create table public.identity_documents (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references public.identity_verifications(id) on delete cascade,
  document_type text not null,
  storage_bucket text not null,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);

create table public.payout_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  key_type public.payout_account_type not null,
  key_last4 text not null check (char_length(key_last4) between 1 and 8),
  key_hash text not null,
  encrypted_key text not null,
  holder_name text not null,
  holder_tax_id_last4 char(4) not null,
  status public.payout_account_status not null default 'pending',
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key_hash)
);
create unique index payout_accounts_primary_uq on public.payout_accounts(user_id) where is_primary and status <> 'disabled';

create table public.payment_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payment_provider_connections (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid references public.profiles(id) on delete cascade,
  provider_id uuid not null references public.payment_providers(id),
  connection_kind public.settlement_model not null,
  external_account_id text not null,
  public_key text,
  scopes text[] not null default '{}',
  live_mode boolean not null default false,
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'error')),
  token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((connection_kind = 'connected_account' and owner_user_id is not null)
    or (connection_kind = 'prosperity_balance' and owner_user_id is null))
);
create unique index payment_provider_connections_owner_uq
  on public.payment_provider_connections(provider_id, owner_user_id)
  where connection_kind = 'connected_account' and status = 'active';
create unique index payment_provider_connections_platform_uq
  on public.payment_provider_connections(provider_id)
  where connection_kind = 'prosperity_balance' and status = 'active';

create table private.payment_provider_credentials (
  connection_id uuid primary key references public.payment_provider_connections(id) on delete cascade,
  access_token text not null,
  refresh_token text,
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  producer_id uuid not null references public.profiles(id),
  name text not null check (char_length(trim(name)) between 2 and 180),
  slug text not null unique,
  description text,
  status public.record_status not null default 'draft',
  settlement_model public.settlement_model not null,
  prosperity_fee_type public.fee_type not null default 'percentage',
  prosperity_fee_bps integer not null default 500 check (prosperity_fee_bps between 0 and 10000),
  prosperity_fee_fixed_cents bigint not null default 0 check (prosperity_fee_fixed_cents >= 0),
  currency char(3) not null default 'BRL' check (currency = upper(currency)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_producer_idx on public.products(producer_id);

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 180),
  checkout_slug text not null unique,
  price_cents bigint not null check (price_cents > 0),
  currency char(3) not null default 'BRL' check (currency = upper(currency)),
  billing_type public.billing_type not null default 'one_time',
  billing_interval text check (billing_interval in ('week', 'month', 'year')),
  billing_interval_count integer check (billing_interval_count is null or billing_interval_count > 0),
  max_installments integer not null default 1 check (max_installments between 1 and 24),
  status public.record_status not null default 'draft',
  affiliate_commission_type public.fee_type not null default 'percentage',
  affiliate_commission_bps integer not null default 0 check (affiliate_commission_bps between 0 and 10000),
  affiliate_commission_fixed_cents bigint not null default 0 check (affiliate_commission_fixed_cents >= 0),
  affiliate_recurrence_mode public.recurrence_mode not null default 'first_payment',
  affiliate_recurrence_cycles integer check (affiliate_recurrence_cycles is null or affiliate_recurrence_cycles > 0),
  affiliate_hold_days integer not null default 7 check (affiliate_hold_days >= 0),
  prosperity_fee_type public.fee_type,
  prosperity_fee_bps integer check (prosperity_fee_bps is null or prosperity_fee_bps between 0 and 10000),
  prosperity_fee_fixed_cents bigint check (prosperity_fee_fixed_cents is null or prosperity_fee_fixed_cents >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((billing_type = 'one_time' and billing_interval is null and billing_interval_count is null)
    or (billing_type = 'recurring' and billing_interval is not null and billing_interval_count is not null))
);
create index offers_product_idx on public.offers(product_id);

create table public.coproducer_invitations (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete cascade,
  invited_email text not null,
  invited_user_id uuid references public.profiles(id),
  participation_bps integer not null check (participation_bps between 1 and 10000),
  token_hash text not null unique,
  status public.invitation_status not null default 'pending',
  invited_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index coproducer_invitations_email_idx on public.coproducer_invitations(lower(invited_email), status);

create table public.product_participants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  invitation_id uuid references public.coproducer_invitations(id),
  participation_bps integer not null check (participation_bps between 1 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (invitation_id is not null)
);
create unique index product_participants_product_uq on public.product_participants(product_id, user_id)
  where offer_id is null;
create unique index product_participants_offer_uq on public.product_participants(product_id, offer_id, user_id)
  where offer_id is not null;
create index product_participants_user_idx on public.product_participants(user_id, active);

create table public.affiliate_programs (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null unique references public.products(id) on delete cascade,
  mode public.affiliate_program_mode not null default 'approval',
  active boolean not null default false,
  terms text,
  cookie_days integer not null default 30 check (cookie_days between 1 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.affiliate_memberships (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.affiliate_programs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null unique,
  status public.membership_status not null default 'pending',
  invited_by uuid references public.profiles(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, user_id)
);
create index affiliate_memberships_user_idx on public.affiliate_memberships(user_id, status);

create table public.affiliate_links (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.affiliate_memberships(id) on delete cascade,
  offer_id uuid references public.offers(id) on delete cascade,
  ref_code text not null unique,
  campaign text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  name text,
  document_hash text,
  phone text,
  external_customer_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_external_customer_id_uq on public.customers(external_customer_id)
  where external_customer_id is not null;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  product_id uuid not null references public.products(id),
  offer_id uuid not null references public.offers(id),
  producer_id uuid not null references public.profiles(id),
  customer_id uuid not null references public.customers(id),
  settlement_model public.settlement_model not null,
  status public.order_status not null default 'draft',
  gross_amount_cents bigint not null check (gross_amount_cents > 0),
  currency char(3) not null default 'BRL',
  idempotency_key text not null unique,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index orders_producer_idx on public.orders(producer_id, created_at desc);
create index orders_offer_idx on public.orders(offer_id, created_at desc);

create table public.affiliate_attributions (
  id uuid primary key default gen_random_uuid(),
  affiliate_link_id uuid not null references public.affiliate_links(id),
  affiliate_membership_id uuid not null references public.affiliate_memberships(id),
  order_id uuid unique references public.orders(id) on delete set null,
  visitor_key_hash text,
  ref_code text not null,
  campaign text,
  attributed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb
);
create index affiliate_attributions_member_idx on public.affiliate_attributions(affiliate_membership_id, attributed_at desc);

create table public.financial_snapshots (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  settlement_model public.settlement_model not null,
  currency char(3) not null,
  gross_amount_cents bigint not null check (gross_amount_cents > 0),
  gateway_fee_amount_cents bigint not null default 0 check (gateway_fee_amount_cents >= 0),
  prosperity_fee_amount_cents bigint not null check (prosperity_fee_amount_cents >= 0),
  affiliate_amount_cents bigint not null default 0 check (affiliate_amount_cents >= 0),
  coproducer_amount_cents bigint not null default 0 check (coproducer_amount_cents >= 0),
  producer_amount_cents bigint not null check (producer_amount_cents >= 0),
  prosperity_split_amount_cents bigint not null check (prosperity_split_amount_cents >= 0),
  calculation_version smallint not null default 1,
  rules jsonb not null,
  created_at timestamptz not null default now(),
  check (
    (settlement_model = 'prosperity_balance' and gross_amount_cents = gateway_fee_amount_cents + prosperity_fee_amount_cents + affiliate_amount_cents + coproducer_amount_cents + producer_amount_cents)
    or
    (settlement_model = 'connected_account' and gross_amount_cents = prosperity_fee_amount_cents + affiliate_amount_cents + coproducer_amount_cents + producer_amount_cents
      and prosperity_split_amount_cents = prosperity_fee_amount_cents + affiliate_amount_cents + coproducer_amount_cents)
  )
);

create table public.financial_allocations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.financial_snapshots(id) on delete restrict,
  allocation_type public.allocation_type not null,
  destination public.allocation_destination not null,
  beneficiary_user_id uuid references public.profiles(id),
  amount_cents bigint not null check (amount_cents >= 0),
  currency char(3) not null,
  rule_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((allocation_type in ('producer', 'affiliate', 'coproducer') and beneficiary_user_id is not null)
    or (allocation_type in ('prosperity_fee', 'gateway_fee') and beneficiary_user_id is null))
);
create unique index financial_allocations_user_type_uq
  on public.financial_allocations(snapshot_id, allocation_type, beneficiary_user_id)
  where beneficiary_user_id is not null;
create unique index financial_allocations_system_type_uq
  on public.financial_allocations(snapshot_id, allocation_type)
  where beneficiary_user_id is null;

create table public.payment_provider_checkouts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  provider_id uuid not null references public.payment_providers(id),
  connection_id uuid not null references public.payment_provider_connections(id),
  external_checkout_id text,
  checkout_url text,
  idempotency_key text not null unique,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payment_provider_checkouts_external_uq
  on public.payment_provider_checkouts(provider_id, external_checkout_id)
  where external_checkout_id is not null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  provider_id uuid not null references public.payment_providers(id),
  connection_id uuid not null references public.payment_provider_connections(id),
  external_payment_id text,
  external_reference text not null unique,
  idempotency_key text not null unique,
  status public.payment_status not null default 'pending',
  gross_amount_cents bigint not null check (gross_amount_cents >= 0),
  provider_fee_amount_cents bigint not null default 0 check (provider_fee_amount_cents >= 0),
  currency char(3) not null default 'BRL',
  status_detail text,
  paid_at timestamptz,
  refunded_at timestamptz,
  raw_provider_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index payments_provider_external_uq on public.payments(provider_id, external_payment_id)
  where external_payment_id is not null;
create index payments_order_idx on public.payments(order_id);
create index payments_status_idx on public.payments(status, created_at);

create table public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  provider_event_id text,
  transaction_type text not null,
  amount_cents bigint,
  status text,
  raw_payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index payment_transactions_event_uq on public.payment_transactions(payment_id, provider_event_id)
  where provider_event_id is not null;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  customer_id uuid not null references public.customers(id),
  offer_id uuid not null references public.offers(id),
  provider_id uuid not null references public.payment_providers(id),
  external_subscription_id text,
  status public.subscription_status not null default 'pending',
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'BRL',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cycle_number integer not null default 0 check (cycle_number >= 0),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index subscriptions_provider_external_uq on public.subscriptions(provider_id, external_subscription_id)
  where external_subscription_id is not null;

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null unique references public.financial_allocations(id) on delete restrict,
  payment_id uuid not null references public.payments(id),
  beneficiary_user_id uuid not null references public.profiles(id),
  commission_type public.allocation_type not null check (commission_type in ('affiliate', 'coproducer')),
  status public.commission_status not null default 'pending',
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null,
  available_at timestamptz not null,
  paid_at timestamptz,
  reversed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index commissions_beneficiary_idx on public.commissions(beneficiary_user_id, status, available_at);

create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  account_type public.ledger_account_type not null,
  user_id uuid references public.profiles(id) on delete cascade,
  currency char(3) not null default 'BRL',
  created_at timestamptz not null default now(),
  check ((account_type = 'user_balance' and user_id is not null)
    or (account_type <> 'user_balance' and user_id is null))
);
create unique index ledger_accounts_user_uq on public.ledger_accounts(user_id, currency) where user_id is not null;
create unique index ledger_accounts_system_uq on public.ledger_accounts(account_type, currency) where user_id is null;

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ledger_accounts(id) on delete restrict,
  order_id uuid references public.orders(id),
  payment_id uuid references public.payments(id),
  settlement_model public.settlement_model not null,
  entry_type public.ledger_entry_type not null,
  status public.ledger_entry_status not null default 'posted',
  amount_cents bigint not null check (amount_cents <> 0),
  currency char(3) not null,
  available_at timestamptz not null default now(),
  source_type text not null,
  source_id uuid not null,
  reference text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (account_id, source_type, source_id, entry_type)
);
create index ledger_entries_account_balance_idx on public.ledger_entries(account_id, status, available_at);
create index ledger_entries_payment_idx on public.ledger_entries(payment_id);

create table public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  payout_account_id uuid not null references public.payout_accounts(id),
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'BRL',
  status public.withdrawal_status not null default 'requested',
  payout_key_type public.payout_account_type not null,
  payout_key_last4 text not null,
  payout_holder_name text not null,
  payout_holder_tax_id_last4 char(4) not null,
  requested_at timestamptz not null default now(),
  processed_at timestamptz,
  paid_at timestamptz,
  operator_id uuid references public.profiles(id),
  receipt_reference text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index withdrawals_user_idx on public.withdrawals(user_id, created_at desc);
create index withdrawals_queue_idx on public.withdrawals(status, requested_at);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  external_refund_id text,
  amount_cents bigint not null check (amount_cents > 0),
  status public.refund_status not null default 'pending',
  idempotency_key text not null unique,
  reason text,
  raw_provider_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index refunds_external_uq on public.refunds(payment_id, external_refund_id) where external_refund_id is not null;

create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id),
  external_dispute_id text not null,
  status public.dispute_status not null default 'opened',
  amount_cents bigint not null check (amount_cents > 0),
  reason text,
  opened_at timestamptz not null,
  closed_at timestamptz,
  raw_provider_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payment_id, external_dispute_id)
);

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.payment_providers(id),
  external_event_id text,
  external_resource_id text,
  event_type text,
  payload_hash text not null,
  payload jsonb not null,
  status public.webhook_event_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  error_message text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index webhook_events_provider_event_uq on public.webhook_events(provider_id, external_event_id)
  where external_event_id is not null;
create unique index webhook_events_provider_hash_uq on public.webhook_events(provider_id, payload_hash);
create index webhook_events_status_idx on public.webhook_events(status, created_at);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_entity_idx on public.audit_events(entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, email)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), new.email);
  insert into public.ledger_accounts(account_type, user_id, currency)
  values ('user_balance', new.id, 'BRL') on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_finance_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('admin', 'finance_operator')
  );
$$;
revoke all on function public.is_finance_admin() from public;
grant execute on function public.is_finance_admin() to authenticated;

create or replace function public.owns_product(target_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.products
    where id = target_product_id and producer_id = (select auth.uid())
  );
$$;
revoke all on function public.owns_product(uuid) from public;
grant execute on function public.owns_product(uuid) to authenticated;

create or replace function public.participates_in_product(target_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.product_participants
    where product_id = target_product_id and user_id = (select auth.uid()) and active
  ) or public.owns_product(target_product_id);
$$;
revoke all on function public.participates_in_product(uuid) from public;
grant execute on function public.participates_in_product(uuid) to authenticated;

create or replace function public.reject_immutable_financial_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'financial records are immutable; create a compensating entry';
end;
$$;
revoke all on function public.reject_immutable_financial_change() from public;

create trigger financial_snapshots_immutable before update or delete on public.financial_snapshots
  for each row execute function public.reject_immutable_financial_change();
create trigger financial_allocations_immutable before update or delete on public.financial_allocations
  for each row execute function public.reject_immutable_financial_change();
create trigger ledger_entries_immutable before update or delete on public.ledger_entries
  for each row execute function public.reject_immutable_financial_change();

create or replace function public.validate_withdrawal_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.user_id <> old.user_id or new.amount_cents <> old.amount_cents or new.payout_account_id <> old.payout_account_id then
    raise exception 'withdrawal financial identity is immutable';
  end if;
  if new.status = old.status then return new; end if;
  if not (
    (old.status = 'requested' and new.status in ('processing', 'rejected', 'cancelled')) or
    (old.status = 'processing' and new.status in ('paid', 'failed'))
  ) then
    raise exception 'invalid withdrawal status transition: % -> %', old.status, new.status;
  end if;
  return new;
end;
$$;
create trigger withdrawals_validate_transition before update on public.withdrawals
  for each row execute function public.validate_withdrawal_transition();

create or replace function public.request_withdrawal(requested_amount_cents bigint, requested_payout_account_id uuid)
returns public.withdrawals
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  payout public.payout_accounts;
  available_cents bigint;
  created_withdrawal public.withdrawals;
  user_account_id uuid;
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if requested_amount_cents <= 0 then raise exception 'withdrawal amount must be positive'; end if;

  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));

  if not exists (
    select 1 from public.identity_verifications
    where user_id = current_user_id and status = 'approved'
  ) then raise exception 'approved identity verification required'; end if;

  select * into payout from public.payout_accounts
  where id = requested_payout_account_id and user_id = current_user_id and status = 'verified';
  if not found then raise exception 'verified payout account not found'; end if;

  insert into public.ledger_accounts(account_type, user_id, currency)
  values ('user_balance', current_user_id, 'BRL') on conflict do nothing;
  select id into user_account_id from public.ledger_accounts
  where user_id = current_user_id and currency = 'BRL';

  select coalesce(sum(amount_cents), 0) into available_cents
  from public.ledger_entries
  where account_id = user_account_id and status = 'posted' and available_at <= now();
  if available_cents < requested_amount_cents then raise exception 'insufficient available balance'; end if;

  insert into public.withdrawals(
    user_id, payout_account_id, amount_cents, currency, payout_key_type,
    payout_key_last4, payout_holder_name, payout_holder_tax_id_last4
  ) values (
    current_user_id, payout.id, requested_amount_cents, 'BRL', payout.key_type,
    payout.key_last4, payout.holder_name, payout.holder_tax_id_last4
  ) returning * into created_withdrawal;

  insert into public.ledger_entries(
    account_id, settlement_model, entry_type, amount_cents, currency,
    source_type, source_id, reference
  ) values (
    user_account_id, 'prosperity_balance', 'withdrawal', -requested_amount_cents, 'BRL',
    'withdrawal', created_withdrawal.id, 'withdrawal:' || created_withdrawal.id
  );
  return created_withdrawal;
end;
$$;
revoke all on function public.request_withdrawal(bigint, uuid) from public;
grant execute on function public.request_withdrawal(bigint, uuid) to authenticated;

create or replace function public.post_payment_financials(target_payment_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  payment_row public.payments;
  allocation_row public.financial_allocations;
  snapshot_row public.financial_snapshots;
  account_id_value uuid;
  inserted_count integer := 0;
  available_time timestamptz;
  mapped_type public.ledger_entry_type;
begin
  select * into payment_row from public.payments where id = target_payment_id and status = 'approved' for update;
  if not found then raise exception 'approved payment not found'; end if;
  select fs.* into snapshot_row from public.financial_snapshots fs where fs.order_id = payment_row.order_id;

  for allocation_row in
    select * from public.financial_allocations where snapshot_id = snapshot_row.id and amount_cents > 0
  loop
    if allocation_row.destination in ('connected_account', 'gateway') then continue; end if;
    if allocation_row.beneficiary_user_id is not null then
      insert into public.ledger_accounts(account_type, user_id, currency)
      values ('user_balance', allocation_row.beneficiary_user_id, allocation_row.currency) on conflict do nothing;
      select id into account_id_value from public.ledger_accounts
      where user_id = allocation_row.beneficiary_user_id and currency = allocation_row.currency;
    elsif allocation_row.allocation_type = 'prosperity_fee' then
      insert into public.ledger_accounts(account_type, currency)
      values ('platform_revenue', allocation_row.currency) on conflict do nothing;
      select id into account_id_value from public.ledger_accounts
      where account_type = 'platform_revenue' and user_id is null and currency = allocation_row.currency;
    else
      continue;
    end if;

    mapped_type := case allocation_row.allocation_type
      when 'producer' then 'sale_credit'::public.ledger_entry_type
      when 'affiliate' then 'affiliate_commission'::public.ledger_entry_type
      when 'coproducer' then 'coproducer_commission'::public.ledger_entry_type
      when 'prosperity_fee' then 'prosperity_fee'::public.ledger_entry_type
      else 'adjustment'::public.ledger_entry_type end;
    available_time := case when allocation_row.allocation_type in ('affiliate', 'coproducer')
      then now() + interval '7 days' else now() end;

    insert into public.ledger_entries(
      account_id, order_id, payment_id, settlement_model, entry_type, amount_cents,
      currency, available_at, source_type, source_id, reference
    ) values (
      account_id_value, payment_row.order_id, payment_row.id, snapshot_row.settlement_model,
      mapped_type, allocation_row.amount_cents, allocation_row.currency, available_time,
      'allocation', allocation_row.id, 'payment:' || payment_row.id
    ) on conflict do nothing;
    if found then inserted_count := inserted_count + 1; end if;

    if allocation_row.allocation_type in ('affiliate', 'coproducer') then
      insert into public.commissions(
        allocation_id, payment_id, beneficiary_user_id, commission_type,
        amount_cents, currency, available_at
      ) values (
        allocation_row.id, payment_row.id, allocation_row.beneficiary_user_id,
        allocation_row.allocation_type, allocation_row.amount_cents,
        allocation_row.currency, available_time
      ) on conflict (allocation_id) do nothing;
    end if;
  end loop;
  return inserted_count;
end;
$$;
revoke all on function public.post_payment_financials(uuid) from public, anon, authenticated;
grant execute on function public.post_payment_financials(uuid) to service_role;

create or replace view public.user_balance_summary
with (security_invoker = true) as
select
  la.user_id,
  la.currency,
  coalesce(sum(le.amount_cents) filter (where le.status = 'posted' and le.available_at > now()), 0)::bigint as pending_cents,
  coalesce(sum(le.amount_cents) filter (where le.status = 'posted' and le.available_at <= now()), 0)::bigint as available_cents,
  coalesce((select sum(w.amount_cents) from public.withdrawals w where w.user_id = la.user_id and w.status in ('requested', 'processing')), 0)::bigint as withdrawing_cents,
  coalesce(sum(le.amount_cents) filter (where le.status = 'posted' and le.amount_cents > 0), 0)::bigint as total_received_cents
from public.ledger_accounts la
left join public.ledger_entries le on le.account_id = la.id
where la.account_type = 'user_balance'
group by la.user_id, la.currency;

insert into public.payment_providers(code, name) values ('mercadopago', 'Mercado Pago');

insert into public.ledger_accounts(account_type, currency) values
  ('platform_revenue', 'BRL'), ('gateway_expense', 'BRL');

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','user_roles','identity_verifications','identity_documents','payout_accounts',
    'payment_providers','payment_provider_connections','products','offers','coproducer_invitations',
    'product_participants','affiliate_programs','affiliate_memberships','affiliate_links','customers',
    'orders','affiliate_attributions','financial_snapshots','financial_allocations','payment_provider_checkouts',
    'payments','payment_transactions','subscriptions','commissions','ledger_accounts','ledger_entries',
    'withdrawals','refunds','disputes','webhook_events','audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('alter table public.%I force row level security', table_name);
  end loop;
end $$;

create policy profiles_select_self on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy profiles_update_self on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy user_roles_select_self on public.user_roles for select to authenticated using ((select auth.uid()) = user_id);
create policy identity_verifications_select_self on public.identity_verifications for select to authenticated using ((select auth.uid()) = user_id or public.is_finance_admin());
create policy identity_documents_select_self on public.identity_documents for select to authenticated using (
  exists (select 1 from public.identity_verifications iv where iv.id = verification_id and (iv.user_id = (select auth.uid()) or public.is_finance_admin()))
);
create policy payout_accounts_select_self on public.payout_accounts for select to authenticated using ((select auth.uid()) = user_id or public.is_finance_admin());
create policy provider_connections_select_owner on public.payment_provider_connections for select to authenticated using ((select auth.uid()) = owner_user_id or public.is_finance_admin());
create policy products_select_related on public.products for select to authenticated using (public.participates_in_product(id));
create policy products_insert_owner on public.products for insert to authenticated with check ((select auth.uid()) = producer_id);
create policy products_update_owner on public.products for update to authenticated using ((select auth.uid()) = producer_id) with check ((select auth.uid()) = producer_id);
create policy products_delete_owner on public.products for delete to authenticated using ((select auth.uid()) = producer_id);
create policy offers_select_related on public.offers for select to authenticated using (public.participates_in_product(product_id));
create policy offers_insert_owner on public.offers for insert to authenticated with check (public.owns_product(product_id));
create policy offers_update_owner on public.offers for update to authenticated using (public.owns_product(product_id)) with check (public.owns_product(product_id));
create policy offers_delete_owner on public.offers for delete to authenticated using (public.owns_product(product_id));
create policy invitations_select_related on public.coproducer_invitations for select to authenticated using (
  public.owns_product(product_id) or invited_user_id = (select auth.uid()) or lower(invited_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
);
create policy participants_select_related on public.product_participants for select to authenticated using (public.participates_in_product(product_id));
create policy affiliate_programs_select_related on public.affiliate_programs for select to authenticated using (public.participates_in_product(product_id));
create policy memberships_select_related on public.affiliate_memberships for select to authenticated using (
  user_id = (select auth.uid()) or exists (select 1 from public.affiliate_programs ap where ap.id = program_id and public.owns_product(ap.product_id))
);
create policy links_select_related on public.affiliate_links for select to authenticated using (
  exists (select 1 from public.affiliate_memberships am where am.id = membership_id and am.user_id = (select auth.uid()))
  or exists (select 1 from public.affiliate_memberships am join public.affiliate_programs ap on ap.id = am.program_id where am.id = membership_id and public.owns_product(ap.product_id))
);
create policy orders_select_producer on public.orders for select to authenticated using (producer_id = (select auth.uid()) or public.is_finance_admin());
create policy attributions_select_related on public.affiliate_attributions for select to authenticated using (
  exists (select 1 from public.affiliate_memberships am where am.id = affiliate_membership_id and am.user_id = (select auth.uid()))
  or exists (select 1 from public.orders o where o.id = order_id and o.producer_id = (select auth.uid()))
);
create policy snapshots_select_related on public.financial_snapshots for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and (o.producer_id = (select auth.uid()) or public.is_finance_admin()))
  or exists (select 1 from public.financial_allocations fa where fa.snapshot_id = id and fa.beneficiary_user_id = (select auth.uid()))
);
create policy allocations_select_related on public.financial_allocations for select to authenticated using (
  beneficiary_user_id = (select auth.uid()) or exists (
    select 1 from public.financial_snapshots fs join public.orders o on o.id = fs.order_id
    where fs.id = snapshot_id and (o.producer_id = (select auth.uid()) or public.is_finance_admin())
  )
);
create policy checkouts_select_producer on public.payment_provider_checkouts for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and (o.producer_id = (select auth.uid()) or public.is_finance_admin()))
);
create policy payments_select_producer on public.payments for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and (o.producer_id = (select auth.uid()) or public.is_finance_admin()))
);
create policy transactions_select_producer on public.payment_transactions for select to authenticated using (
  exists (select 1 from public.payments p join public.orders o on o.id = p.order_id where p.id = payment_id and (o.producer_id = (select auth.uid()) or public.is_finance_admin()))
);
create policy subscriptions_select_producer on public.subscriptions for select to authenticated using (
  exists (select 1 from public.orders o where o.id = order_id and (o.producer_id = (select auth.uid()) or public.is_finance_admin()))
);
create policy commissions_select_related on public.commissions for select to authenticated using (
  beneficiary_user_id = (select auth.uid()) or exists (select 1 from public.payments p join public.orders o on o.id = p.order_id where p.id = payment_id and o.producer_id = (select auth.uid())) or public.is_finance_admin()
);
create policy ledger_accounts_select_self on public.ledger_accounts for select to authenticated using (user_id = (select auth.uid()) or public.is_finance_admin());
create policy ledger_entries_select_self on public.ledger_entries for select to authenticated using (
  exists (select 1 from public.ledger_accounts la where la.id = account_id and (la.user_id = (select auth.uid()) or public.is_finance_admin()))
);
create policy withdrawals_select_self on public.withdrawals for select to authenticated using (user_id = (select auth.uid()) or public.is_finance_admin());
create policy refunds_select_producer on public.refunds for select to authenticated using (
  exists (select 1 from public.payments p join public.orders o on o.id = p.order_id where p.id = payment_id and (o.producer_id = (select auth.uid()) or public.is_finance_admin()))
);
create policy disputes_select_producer on public.disputes for select to authenticated using (
  exists (select 1 from public.payments p join public.orders o on o.id = p.order_id where p.id = payment_id and (o.producer_id = (select auth.uid()) or public.is_finance_admin()))
);
create policy audit_events_admin_only on public.audit_events for select to authenticated using (public.is_finance_admin());

grant usage on schema public to anon, authenticated;
grant select on public.payment_providers to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.user_roles, public.identity_verifications, public.identity_documents, public.payout_accounts,
  public.payment_provider_connections, public.products, public.offers, public.coproducer_invitations,
  public.product_participants, public.affiliate_programs, public.affiliate_memberships, public.affiliate_links,
  public.orders, public.affiliate_attributions, public.financial_snapshots, public.financial_allocations,
  public.payment_provider_checkouts, public.payments, public.payment_transactions, public.subscriptions,
  public.commissions, public.ledger_accounts, public.ledger_entries, public.withdrawals, public.refunds,
  public.disputes, public.audit_events, public.user_balance_summary to authenticated;
grant insert, update, delete on public.products, public.offers to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','identity_verifications','payout_accounts','payment_provider_connections','products','offers',
    'coproducer_invitations','product_participants','affiliate_programs','affiliate_memberships','affiliate_links',
    'customers','orders','payment_provider_checkouts','payments','subscriptions','commissions','withdrawals',
    'refunds','disputes'
  ] loop
    execute format('create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

commit;
