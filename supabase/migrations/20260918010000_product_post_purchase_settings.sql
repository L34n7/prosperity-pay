alter table public.products
  add column post_purchase_message text,
  add column post_purchase_redirect_url text;

alter table public.products
  add constraint products_post_purchase_message_length_check
    check (post_purchase_message is null or char_length(post_purchase_message) <= 4000),
  add constraint products_post_purchase_redirect_url_length_check
    check (post_purchase_redirect_url is null or char_length(post_purchase_redirect_url) <= 2048),
  add constraint products_post_purchase_redirect_url_protocol_check
    check (post_purchase_redirect_url is null or post_purchase_redirect_url ~* '^https?://');

grant insert (post_purchase_message, post_purchase_redirect_url)
  on public.products to authenticated;

grant update (post_purchase_message, post_purchase_redirect_url)
  on public.products to authenticated;

-- Preserve the current CRM Prosperity post-purchase destination as product data,
-- removing the need for checkout-specific hardcoded routing.
update public.products
set post_purchase_redirect_url = 'https://crmprosperity.com/obrigado'
where lower(trim(name)) like 'crm prosperity%'
  and post_purchase_redirect_url is null;
