create table if not exists public.admin_temporary_access_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  target_user_id uuid not null references auth.users(id) on delete cascade,
  target_email text not null,
  purpose text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.admin_temporary_access_tokens enable row level security;

revoke all on table public.admin_temporary_access_tokens from anon, authenticated;

create index if not exists admin_temporary_access_tokens_target_user_idx
  on public.admin_temporary_access_tokens(target_user_id, created_at desc);

create index if not exists admin_temporary_access_tokens_expires_idx
  on public.admin_temporary_access_tokens(expires_at)
  where used_at is null;
