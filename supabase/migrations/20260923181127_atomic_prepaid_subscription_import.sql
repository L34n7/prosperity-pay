
begin;

create or replace function public.import_prepaid_subscription(
  target_product_id uuid,
  target_customer_id uuid,
  target_offer_id uuid,
  target_provider_id uuid,
  target_external_reference text,
  target_status public.subscription_status,
  target_amount_cents bigint,
  target_currency char(3),
  target_period_start timestamptz,
  target_period_end timestamptz,
  target_affiliate_membership_id uuid,
  target_affiliate_link_id uuid,
  target_item_code text,
  target_item_description text,
  target_metadata jsonb
)
returns table(subscription_id uuid, imported boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_id uuid;
begin
  insert into public.subscriptions(
    order_id,
    product_id,
    customer_id,
    offer_id,
    provider_id,
    external_reference,
    status,
    amount_cents,
    base_amount_cents,
    current_amount_cents,
    billing_model,
    currency,
    current_period_start,
    current_period_end,
    next_due_at,
    cycle_number,
    affiliate_membership_id,
    affiliate_link_id,
    metadata
  )
  values (
    null,
    target_product_id,
    target_customer_id,
    target_offer_id,
    target_provider_id,
    target_external_reference,
    target_status,
    target_amount_cents,
    target_amount_cents,
    target_amount_cents,
    'prepaid',
    target_currency,
    target_period_start,
    target_period_end,
    target_period_end,
    1,
    target_affiliate_membership_id,
    target_affiliate_link_id,
    coalesce(target_metadata, '{}'::jsonb)
  )
  on conflict (product_id, external_reference)
    where external_reference is not null
  do nothing
  returning id into created_id;

  if created_id is not null then
    insert into public.subscription_items(
      subscription_id,
      item_type,
      offer_id,
      code,
      description,
      unit_amount_cents,
      quantity,
      status,
      activated_at
    )
    values (
      created_id,
      'base',
      target_offer_id,
      target_item_code,
      target_item_description,
      target_amount_cents,
      1,
      'active',
      target_period_start
    );

    subscription_id := created_id;
    imported := true;
    return next;
    return;
  end if;

  select s.id
  into subscription_id
  from public.subscriptions s
  where s.product_id = target_product_id
    and s.external_reference = target_external_reference
  limit 1;

  if subscription_id is null then
    raise exception 'subscription import conflict without existing row';
  end if;

  imported := false;
  return next;
end;
$$;

revoke all on function public.import_prepaid_subscription(
  uuid, uuid, uuid, uuid, text, public.subscription_status, bigint, char,
  timestamptz, timestamptz, uuid, uuid, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.import_prepaid_subscription(
  uuid, uuid, uuid, uuid, text, public.subscription_status, bigint, char,
  timestamptz, timestamptz, uuid, uuid, text, text, jsonb
) to service_role;

commit;
