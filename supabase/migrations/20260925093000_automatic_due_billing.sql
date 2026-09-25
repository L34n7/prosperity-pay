begin;

alter table public.products
  add column if not exists automatic_due_billing_enabled boolean not null default false,
  add column if not exists partner_payment_emails_enabled boolean not null default true;

comment on column public.products.automatic_due_billing_enabled is
  'When enabled for prepaid recurring products, Prosperity Pay generates the due-cycle PIX and sends the customer a billing email on the due date.';

comment on column public.products.partner_payment_emails_enabled is
  'Controls producer/coproducer/affiliate payment notification emails for this product. Customer due-billing emails are controlled separately.';

create table if not exists public.subscription_billing_deliveries (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  due_at timestamptz not null,
  status text not null default 'processing'
    check (status in ('processing','sent','failed','skipped')),
  order_id uuid references public.orders(id) on delete set null,
  payment_id uuid references public.payments(id) on delete set null,
  checkout_url text,
  pix_code text,
  pix_ticket_url text,
  recipient_email text,
  attempts integer not null default 1 check (attempts > 0),
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(subscription_id, due_at)
);

create index if not exists subscription_billing_deliveries_due_idx
  on public.subscription_billing_deliveries(status, due_at);

alter table public.subscription_billing_deliveries enable row level security;
alter table public.subscription_billing_deliveries force row level security;

create policy subscription_billing_deliveries_select_related
  on public.subscription_billing_deliveries
  for select to authenticated
  using (
    public.owns_product(product_id)
    or public.is_finance_admin()
  );

grant select on public.subscription_billing_deliveries to authenticated;

create trigger subscription_billing_deliveries_set_updated_at
  before update on public.subscription_billing_deliveries
  for each row execute function public.set_updated_at();

-- CRM Prosperity: cobrança automática ao cliente, sem os e-mails financeiros
-- genéricos destinados a produtor/coprodutor/afiliado.
update public.products
set
  automatic_due_billing_enabled = true,
  partner_payment_emails_enabled = false
where lower(trim(name)) = 'crm prosperity'
  and payment_type = 'recurring';

commit;
