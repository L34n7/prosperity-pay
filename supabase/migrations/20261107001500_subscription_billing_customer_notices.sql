begin;

create table if not exists public.subscription_billing_notices (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  due_at timestamptz not null,
  notice_type text not null check (notice_type in ('pre_due_3d','overdue_3d','overdue_6d')),
  recipient_email text not null,
  status text not null default 'processing'
    check (status in ('processing','sent','failed','skipped')),
  attempts integer not null default 1 check (attempts >= 1),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, due_at, notice_type)
);

create index if not exists subscription_billing_notices_status_idx
  on public.subscription_billing_notices(status, due_at);
alter table public.subscription_billing_notices enable row level security;
alter table public.subscription_billing_notices force row level security;

drop policy if exists subscription_billing_notices_select_related on public.subscription_billing_notices;
create policy subscription_billing_notices_select_related
  on public.subscription_billing_notices for select to authenticated
  using (public.owns_product(product_id) or public.is_finance_admin());
grant select on public.subscription_billing_notices to authenticated;
drop trigger if exists subscription_billing_notices_set_updated_at on public.subscription_billing_notices;
create trigger subscription_billing_notices_set_updated_at
  before update on public.subscription_billing_notices
  for each row execute function public.set_updated_at();

comment on table public.subscription_billing_notices is
  'Idempotent email notices before billing due date and overdue reminders; distinct from the invoice delivery.';

commit;
