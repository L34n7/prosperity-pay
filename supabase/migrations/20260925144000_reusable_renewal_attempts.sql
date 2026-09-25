begin;

create table if not exists public.subscription_renewal_payment_claims (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  due_at timestamptz not null,
  payment_id uuid not null references public.payments(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(subscription_id, due_at),
  unique(payment_id)
);

alter table public.subscription_renewal_payment_claims enable row level security;
alter table public.subscription_renewal_payment_claims force row level security;

create or replace function public.claim_prepaid_subscription_renewal_payment(
  target_subscription_id uuid,
  target_payment_id uuid,
  target_due_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed boolean := false;
begin
  insert into public.subscription_renewal_payment_claims(
    subscription_id,
    due_at,
    payment_id
  )
  values (
    target_subscription_id,
    target_due_at,
    target_payment_id
  )
  on conflict (subscription_id, due_at) do nothing;

  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

revoke all on function public.claim_prepaid_subscription_renewal_payment(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_prepaid_subscription_renewal_payment(uuid, uuid, timestamptz)
  to service_role;

commit;
