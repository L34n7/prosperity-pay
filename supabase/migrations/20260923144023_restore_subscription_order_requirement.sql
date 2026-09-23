
begin;

alter table public.subscriptions
  alter column order_id set not null;

commit;
