alter table public.products
  add column if not exists affiliate_funnel_base_url text;

alter table public.products
  drop constraint if exists products_affiliate_funnel_base_url_length_check,
  add constraint products_affiliate_funnel_base_url_length_check
    check (affiliate_funnel_base_url is null or char_length(affiliate_funnel_base_url) <= 2048),
  drop constraint if exists products_affiliate_funnel_base_url_format_check,
  add constraint products_affiliate_funnel_base_url_format_check
    check (
      affiliate_funnel_base_url is null
      or affiliate_funnel_base_url ~* '^https?://.+[?&]ref=$'
    );

grant insert (affiliate_funnel_base_url) on public.products to authenticated;
grant update (affiliate_funnel_base_url) on public.products to authenticated;

update public.products
set affiliate_funnel_base_url = 'https://crmprosperity.com/comecar?ref='
where lower(trim(name)) like 'crm prosperity%'
  and affiliate_funnel_base_url is null;
