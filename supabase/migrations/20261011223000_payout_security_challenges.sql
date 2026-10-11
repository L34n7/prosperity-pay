begin;

create table if not exists public.payout_security_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  purpose text not null default 'payout_account'
    check (purpose = 'payout_account'),
  action text not null
    check (action in ('create','update')),
  target_payout_account_id uuid references public.payout_accounts(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  used_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payout_security_challenges_user_idx
  on public.payout_security_challenges(user_id, created_at desc);

create index if not exists payout_security_challenges_active_idx
  on public.payout_security_challenges(user_id, purpose, expires_at)
  where used_at is null and invalidated_at is null;

alter table public.payout_security_challenges enable row level security;
alter table public.payout_security_challenges force row level security;

create trigger payout_security_challenges_set_updated_at
  before update on public.payout_security_challenges
  for each row execute function public.set_updated_at();

commit;