create table if not exists public.integration_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null default gen_random_uuid(),
  integration text not null,
  payment_id uuid not null references public.payments(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  response_status integer,
  response_body text,
  last_error text,
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_webhook_deliveries_event_id_key unique (event_id),
  constraint integration_webhook_deliveries_payment_event_key unique (integration, payment_id, event_type)
);

create index if not exists integration_webhook_deliveries_status_idx
  on public.integration_webhook_deliveries (integration, status, created_at);

alter table public.integration_webhook_deliveries enable row level security;
alter table public.integration_webhook_deliveries force row level security;

revoke all on public.integration_webhook_deliveries from anon, authenticated;
grant all on public.integration_webhook_deliveries to service_role;

create or replace function public.set_integration_webhook_deliveries_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_integration_webhook_deliveries_updated_at
  on public.integration_webhook_deliveries;

create trigger trg_integration_webhook_deliveries_updated_at
before update on public.integration_webhook_deliveries
for each row execute function public.set_integration_webhook_deliveries_updated_at();
