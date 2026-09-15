begin;

alter table public.subscriptions
  add column if not exists payment_profile_id text;

create index if not exists subscriptions_payment_profile_idx
  on public.subscriptions(payment_profile_id)
  where payment_profile_id is not null;

commit;
