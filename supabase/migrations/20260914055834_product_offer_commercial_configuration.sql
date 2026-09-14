alter table public.products
  add column payment_type text not null default 'one_time',
  add column product_type text not null default 'digital',
  add column category text,
  add column support_display_name text,
  add column support_email text,
  add column support_whatsapp text,
  add column recurrence_frequency text,
  add column different_first_charge boolean not null default false,
  add column first_charge_cents bigint,
  add column recurring_price_cents bigint,
  add column main_offer_price_cents bigint;

update public.products p
set main_offer_price_cents = (
  select o.price_cents
  from public.offers o
  where o.product_id = p.id
  order by o.created_at asc
  limit 1
)
where p.payment_type = 'one_time'
  and p.main_offer_price_cents is null
  and exists (select 1 from public.offers o where o.product_id = p.id);

alter table public.products
  add constraint products_payment_type_check check (payment_type in ('one_time', 'recurring')),
  add constraint products_product_type_check check (product_type in ('digital', 'physical')),
  add constraint products_category_length_check check (category is null or char_length(category) <= 120),
  add constraint products_support_display_name_length_check check (support_display_name is null or char_length(support_display_name) <= 180),
  add constraint products_support_email_length_check check (support_email is null or char_length(support_email) <= 320),
  add constraint products_support_whatsapp_length_check check (support_whatsapp is null or char_length(support_whatsapp) <= 32),
  add constraint products_recurrence_frequency_check check (recurrence_frequency is null or recurrence_frequency in ('weekly', 'monthly', 'quarterly', 'semiannual', 'annual')),
  add constraint products_first_charge_positive_check check (first_charge_cents is null or first_charge_cents > 0),
  add constraint products_recurring_price_positive_check check (recurring_price_cents is null or recurring_price_cents > 0),
  add constraint products_main_offer_price_positive_check check (main_offer_price_cents is null or main_offer_price_cents > 0),
  add constraint products_commercial_configuration_check check (
    (
      payment_type = 'one_time'
      and recurrence_frequency is null
      and recurring_price_cents is null
      and different_first_charge = false
      and first_charge_cents is null
    )
    or
    (
      payment_type = 'recurring'
      and recurrence_frequency is not null
      and recurring_price_cents is not null
      and (
        (different_first_charge = true and first_charge_cents is not null)
        or (different_first_charge = false and first_charge_cents is null)
      )
    )
  );

alter table public.offers
  add column payment_card_enabled boolean not null default true,
  add column payment_pix_enabled boolean not null default true,
  add column primary_payment_method text not null default 'card',
  add column first_charge_cents bigint,
  add column affiliate_enabled boolean not null default false;

update public.offers
set affiliate_enabled = true
where affiliate_commission_bps > 0;

alter table public.offers
  drop constraint if exists offers_installments_by_price_check;

alter table public.offers
  add constraint offers_installments_by_price_check check (
    max_installments between 1 and greatest(1, least(12::bigint, price_cents / 5000))::integer
  ),
  add constraint offers_payment_method_check check (payment_card_enabled or payment_pix_enabled),
  add constraint offers_primary_payment_method_check check (
    (primary_payment_method = 'card' and payment_card_enabled)
    or (primary_payment_method = 'pix' and payment_pix_enabled)
  ),
  add constraint offers_first_charge_positive_check check (first_charge_cents is null or first_charge_cents > 0),
  add constraint offers_first_charge_billing_check check (
    (billing_type = 'one_time' and first_charge_cents is null)
    or billing_type = 'recurring'
  ),
  add constraint offers_card_installments_check check (payment_card_enabled or max_installments = 1);

grant insert (
  payment_type, product_type, category, support_display_name, support_email, support_whatsapp,
  recurrence_frequency, different_first_charge, first_charge_cents, recurring_price_cents,
  main_offer_price_cents
) on public.products to authenticated;

grant update (
  payment_type, product_type, category, support_display_name, support_email, support_whatsapp,
  recurrence_frequency, different_first_charge, first_charge_cents, recurring_price_cents,
  main_offer_price_cents
) on public.products to authenticated;

grant insert (
  payment_card_enabled, payment_pix_enabled, primary_payment_method,
  first_charge_cents, affiliate_enabled, affiliate_commission_bps
) on public.offers to authenticated;

grant update (
  billing_type, billing_interval, billing_interval_count, payment_card_enabled,
  payment_pix_enabled, primary_payment_method, first_charge_cents, affiliate_enabled
) on public.offers to authenticated;
