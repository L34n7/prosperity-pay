-- Permite que checkouts legados de R$ 137 emitidos antes da correção
-- do Plano Básico VIP continuem pagáveis sem alterar o preço futuro de R$ 60.
create or replace function public.apply_prepaid_subscription_renewal(
  target_subscription_id uuid,
  target_payment_id uuid,
  target_period_start timestamp with time zone,
  target_period_end timestamp with time zone
)
returns public.subscriptions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  payment_row public.payments;
  subscription_row public.subscriptions;
  change_row public.subscription_changes;
  calculated_total bigint;
  legacy_vip_checkout boolean := false;
begin
  select p.* into payment_row
  from public.payments p
  join public.orders o on o.id = p.order_id
  where p.id = target_payment_id
    and p.status = 'approved'
    and o.subscription_id = target_subscription_id
    and o.billing_reason = 'subscription_renewal'
  for update of p;

  if not found then
    raise exception 'approved renewal payment not found';
  end if;

  select * into subscription_row
  from public.subscriptions
  where id = target_subscription_id
  for update;

  if not found then
    raise exception 'subscription not found';
  end if;

  for change_row in
    select *
    from public.subscription_changes
    where subscription_id = target_subscription_id
      and status = 'scheduled'
      and effective_mode = 'next_period_after_payment'
    order by created_at, id
    for update
  loop
    update public.subscription_changes
    set status = 'applying',
        paid_at = coalesce(paid_at, payment_row.paid_at, now()),
        effective_at = coalesce(effective_at, target_period_start)
    where id = change_row.id;

    perform private.apply_subscription_change_state(change_row.id);
  end loop;

  select coalesce(sum(unit_amount_cents * quantity), 0)::bigint
  into calculated_total
  from public.subscription_items
  where subscription_id = target_subscription_id
    and status = 'active';

  legacy_vip_checkout :=
    coalesce(subscription_row.metadata ->> 'vip_price_correction', '') = 'true'
    and calculated_total = 6000
    and payment_row.gross_amount_cents = 13700;

  if calculated_total <> payment_row.gross_amount_cents
     and not legacy_vip_checkout then
    raise exception 'renewal amount does not match active subscription items';
  end if;

  update public.subscriptions
  set status = 'active',
      cycle_number = cycle_number + 1,
      current_period_start = target_period_start,
      current_period_end = target_period_end,
      next_due_at = target_period_end,
      current_amount_cents = calculated_total,
      amount_cents = calculated_total,
      metadata = case
        when legacy_vip_checkout then
          coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'legacy_vip_checkout_last_paid_at', coalesce(payment_row.paid_at, now()),
            'legacy_vip_checkout_last_amount_cents', payment_row.gross_amount_cents
          )
        else metadata
      end
  where id = target_subscription_id
  returning * into subscription_row;

  return subscription_row;
end;
$function$;
