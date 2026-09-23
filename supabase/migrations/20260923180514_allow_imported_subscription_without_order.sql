
begin;
alter table public.subscriptions
  alter column order_id drop not null;
commit;
