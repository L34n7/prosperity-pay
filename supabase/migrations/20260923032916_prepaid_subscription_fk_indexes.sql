
begin;

create index if not exists order_items_subscription_item_idx
  on public.order_items(subscription_item_id)
  where subscription_item_id is not null;

create index if not exists subscription_changes_addon_idx
  on public.subscription_changes(addon_id)
  where addon_id is not null;

create index if not exists subscription_changes_from_offer_idx
  on public.subscription_changes(from_offer_id)
  where from_offer_id is not null;

create index if not exists subscription_changes_to_offer_idx
  on public.subscription_changes(to_offer_id)
  where to_offer_id is not null;

create index if not exists subscription_changes_payment_order_idx
  on public.subscription_changes(payment_order_id)
  where payment_order_id is not null;

create index if not exists subscription_checkout_sessions_change_idx
  on public.subscription_checkout_sessions(subscription_change_id)
  where subscription_change_id is not null;

create index if not exists subscription_items_addon_idx
  on public.subscription_items(addon_id)
  where addon_id is not null;

create index if not exists subscription_items_offer_idx
  on public.subscription_items(offer_id)
  where offer_id is not null;

create index if not exists subscriptions_affiliate_link_idx
  on public.subscriptions(affiliate_link_id)
  where affiliate_link_id is not null;

create index if not exists subscriptions_affiliate_membership_idx
  on public.subscriptions(affiliate_membership_id)
  where affiliate_membership_id is not null;

commit;
