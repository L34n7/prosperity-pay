create table if not exists public.integration_webhook_routes (
  id uuid primary key default gen_random_uuid(),
  integration text not null,
  offer_reference text not null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_webhook_routes_integration_reference_key unique (integration, offer_reference)
);

create index if not exists integration_webhook_routes_active_idx
  on public.integration_webhook_routes (integration, active, offer_reference);

alter table public.integration_webhook_routes enable row level security;
alter table public.integration_webhook_routes force row level security;

revoke all on public.integration_webhook_routes from anon, authenticated;
grant all on public.integration_webhook_routes to service_role;

create or replace function public.set_integration_webhook_routes_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_integration_webhook_routes_updated_at
  on public.integration_webhook_routes;

create trigger trg_integration_webhook_routes_updated_at
before update on public.integration_webhook_routes
for each row execute function public.set_integration_webhook_routes_updated_at();

insert into public.integration_webhook_routes (integration, offer_reference, active, metadata)
values
  ('crm_prosperity', 'plano-basic-be3817c7', true, '{"plan_slug":"basico","purpose":"crm_subscription"}'::jsonb),
  ('crm_prosperity', 'c7074bf9e18e', true, '{"plan_slug":"essencial","purpose":"crm_subscription"}'::jsonb),
  ('crm_prosperity', '248a0b141abf', true, '{"plan_slug":"basico","purpose":"integration_test"}'::jsonb)
on conflict (integration, offer_reference) do update
set active = excluded.active,
    metadata = excluded.metadata,
    updated_at = now();
