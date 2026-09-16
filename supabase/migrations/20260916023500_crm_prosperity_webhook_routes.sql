create table if not exists public.integration_webhook_routes (
  id uuid primary key default gen_random_uuid(),
  integration text not null,
  offer_id uuid not null references public.offers(id) on delete cascade,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint integration_webhook_routes_integration_offer_key unique (integration, offer_id)
);

create index if not exists integration_webhook_routes_active_idx
  on public.integration_webhook_routes (integration, active, offer_id);

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
