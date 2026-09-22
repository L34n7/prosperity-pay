-- E-mail notifications for payment lifecycle events.
-- Keeps delivery idempotent across checkout retries and Mercado Pago webhook retries.

create table if not exists public.payment_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete cascade,
  event_type text not null,
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_email text not null,
  recipient_role text not null,
  status text not null default 'pending',
  attempts integer not null default 1,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_email_deliveries_event_type_check
    check (event_type in ('pix_generated', 'payment_approved')),
  constraint payment_email_deliveries_recipient_role_check
    check (recipient_role in ('producer', 'coproducer', 'affiliate')),
  constraint payment_email_deliveries_status_check
    check (status in ('pending', 'sent', 'failed')),
  constraint payment_email_deliveries_attempts_check
    check (attempts >= 1),
  constraint payment_email_deliveries_unique_recipient
    unique (payment_id, event_type, recipient_user_id, recipient_role)
);

create index if not exists payment_email_deliveries_payment_idx
  on public.payment_email_deliveries(payment_id);

create index if not exists payment_email_deliveries_status_idx
  on public.payment_email_deliveries(status, created_at);

alter table public.payment_email_deliveries enable row level security;

revoke all on public.payment_email_deliveries from public, anon, authenticated;
grant all on public.payment_email_deliveries to service_role;
