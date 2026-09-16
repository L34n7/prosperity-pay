create table if not exists public.platform_integrations (
  id uuid primary key default gen_random_uuid(),
  integration_key text not null unique,
  name text not null,
  webhook_url text not null,
  secret_encrypted text not null,
  secret_last_four text not null,
  status text not null default 'active' check (status in ('active','disconnected')),
  created_by uuid references auth.users(id) on delete set null,
  last_updated_by uuid references auth.users(id) on delete set null,
  last_tested_at timestamptz,
  last_test_status text check (last_test_status is null or last_test_status in ('success','failed')),
  last_test_http_status integer,
  last_test_message text,
  disconnected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists platform_integrations_status_idx
  on public.platform_integrations(status, integration_key);
create index if not exists platform_integrations_created_by_idx
  on public.platform_integrations(created_by);
create index if not exists platform_integrations_last_updated_by_idx
  on public.platform_integrations(last_updated_by);

alter table public.platform_integrations enable row level security;
alter table public.platform_integrations force row level security;

revoke all on table public.platform_integrations from anon, authenticated;
grant all on table public.platform_integrations to service_role;
