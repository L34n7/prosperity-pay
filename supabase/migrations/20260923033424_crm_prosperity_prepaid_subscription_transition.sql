
begin;

alter table public.subscriptions
  alter column order_id drop not null,
  add column if not exists external_reference text;

create unique index if not exists subscriptions_external_reference_uq
  on public.subscriptions(product_id, external_reference)
  where external_reference is not null;

update public.products
set payment_type = 'recurring',
    billing_model = 'prepaid',
    recurrence_frequency = 'monthly',
    recurring_price_cents = 13700,
    main_offer_price_cents = null
where id = 'ccc64bca-765c-4ba7-bc96-d5a0cc6c60d2';

update public.offers
set billing_type = 'recurring',
    billing_interval = 'month',
    billing_interval_count = 1,
    max_installments = 1,
    first_charge_cents = null,
    affiliate_recurrence_mode = 'lifetime_recurring',
    affiliate_recurrence_cycles = null
where product_id = 'ccc64bca-765c-4ba7-bc96-d5a0cc6c60d2'
  and checkout_slug in (
    'plano-basic-be3817c7',
    'c7074bf9e18e',
    '248a0b141abf',
    '3c43f1e480b7',
    '2ce9243c812e'
  );

insert into public.product_addons(
  product_id, code, name, description, unit_amount_cents, currency, active
)
values (
  'ccc64bca-765c-4ba7-bc96-d5a0cc6c60d2',
  'whatsapp_number',
  'Número WhatsApp adicional',
  'Número adicional recorrente do WhatsApp para a assinatura do CRM Prosperity.',
  6000,
  'BRL',
  true
)
on conflict (product_id, code) do update
set name = excluded.name,
    description = excluded.description,
    unit_amount_cents = excluded.unit_amount_cents,
    active = true,
    updated_at = now();

update public.affiliate_programs
set commission_addons = false,
    commission_prorated_changes = false
where product_id = 'ccc64bca-765c-4ba7-bc96-d5a0cc6c60d2';

commit;
