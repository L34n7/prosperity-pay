begin;

create table if not exists public.subscription_billing_transitions (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  billing_reason text not null,
  previous_state jsonb not null default '{}'::jsonb,
  applied_state jsonb not null default '{}'::jsonb,
  reverted_at timestamptz null,
  reversal_status text null,
  replacement_payment_id uuid null references public.payments(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_billing_transitions_payment_uq unique (payment_id)
);

create index if not exists subscription_billing_transitions_subscription_idx
  on public.subscription_billing_transitions(subscription_id, created_at desc);

alter table public.subscription_billing_transitions enable row level security;

create or replace function public.activate_prepaid_subscription(
  target_subscription_id uuid,
  target_payment_id uuid,
  target_period_start timestamptz,
  target_period_end timestamptz
)
returns public.subscriptions
language plpgsql
security definer
set search_path to ''
as $function$
declare
  payment_row public.payments;
  subscription_row public.subscriptions;
  previous_items jsonb := '[]'::jsonb;
begin
  select p.* into payment_row
  from public.payments p
  join public.orders o on o.id = p.order_id
  where p.id = target_payment_id
    and p.status = 'approved'
    and o.subscription_id = target_subscription_id
    and o.billing_reason = 'subscription_initial'
  for update of p;

  if not found then
    raise exception 'approved initial subscription payment not found';
  end if;

  select * into subscription_row
  from public.subscriptions
  where id = target_subscription_id
  for update;

  if not found then
    raise exception 'subscription not found';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', si.id,
        'item_type', si.item_type,
        'offer_id', si.offer_id,
        'addon_id', si.addon_id,
        'code', si.code,
        'description', si.description,
        'unit_amount_cents', si.unit_amount_cents,
        'quantity', si.quantity,
        'status', si.status,
        'activated_at', si.activated_at,
        'ended_at', si.ended_at,
        'metadata', si.metadata
      )
      order by si.created_at, si.id
    ) filter (where si.status = 'active'),
    '[]'::jsonb
  )
  into previous_items
  from public.subscription_items si
  where si.subscription_id = target_subscription_id;

  insert into public.subscription_billing_transitions(
    subscription_id, order_id, payment_id, billing_reason, previous_state
  )
  values (
    target_subscription_id,
    payment_row.order_id,
    target_payment_id,
    'subscription_initial',
    jsonb_build_object(
      'status', subscription_row.status,
      'cycle_number', subscription_row.cycle_number,
      'current_period_start', subscription_row.current_period_start,
      'current_period_end', subscription_row.current_period_end,
      'next_due_at', subscription_row.next_due_at,
      'cancelled_at', subscription_row.cancelled_at,
      'offer_id', subscription_row.offer_id,
      'amount_cents', subscription_row.amount_cents,
      'base_amount_cents', subscription_row.base_amount_cents,
      'current_amount_cents', subscription_row.current_amount_cents,
      'items', previous_items
    )
  )
  on conflict (payment_id) do nothing;

  update public.subscription_items
  set status = 'active',
      activated_at = coalesce(activated_at, target_period_start),
      updated_at = now()
  where subscription_id = target_subscription_id
    and status = 'pending';

  update public.subscriptions
  set status = 'active',
      cycle_number = greatest(1, cycle_number),
      current_period_start = target_period_start,
      current_period_end = target_period_end,
      next_due_at = target_period_end,
      amount_cents = current_amount_cents,
      cancelled_at = null,
      updated_at = now()
  where id = target_subscription_id
  returning * into subscription_row;

  update public.subscription_billing_transitions
  set applied_state = jsonb_build_object(
        'status', subscription_row.status,
        'cycle_number', subscription_row.cycle_number,
        'current_period_start', subscription_row.current_period_start,
        'current_period_end', subscription_row.current_period_end,
        'next_due_at', subscription_row.next_due_at,
        'offer_id', subscription_row.offer_id,
        'amount_cents', subscription_row.amount_cents,
        'base_amount_cents', subscription_row.base_amount_cents,
        'current_amount_cents', subscription_row.current_amount_cents
      ),
      updated_at = now()
  where payment_id = target_payment_id;

  return subscription_row;
end;
$function$;

create or replace function public.apply_prepaid_subscription_renewal(
  target_subscription_id uuid,
  target_payment_id uuid,
  target_period_start timestamptz,
  target_period_end timestamptz
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
  previous_items jsonb := '[]'::jsonb;
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

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', si.id,
        'item_type', si.item_type,
        'offer_id', si.offer_id,
        'addon_id', si.addon_id,
        'code', si.code,
        'description', si.description,
        'unit_amount_cents', si.unit_amount_cents,
        'quantity', si.quantity,
        'status', si.status,
        'activated_at', si.activated_at,
        'ended_at', si.ended_at,
        'metadata', si.metadata
      )
      order by si.created_at, si.id
    ) filter (where si.status = 'active'),
    '[]'::jsonb
  )
  into previous_items
  from public.subscription_items si
  where si.subscription_id = target_subscription_id;

  insert into public.subscription_billing_transitions(
    subscription_id, order_id, payment_id, billing_reason, previous_state
  )
  values (
    target_subscription_id,
    payment_row.order_id,
    target_payment_id,
    'subscription_renewal',
    jsonb_build_object(
      'status', subscription_row.status,
      'cycle_number', subscription_row.cycle_number,
      'current_period_start', subscription_row.current_period_start,
      'current_period_end', subscription_row.current_period_end,
      'next_due_at', subscription_row.next_due_at,
      'cancelled_at', subscription_row.cancelled_at,
      'offer_id', subscription_row.offer_id,
      'amount_cents', subscription_row.amount_cents,
      'base_amount_cents', subscription_row.base_amount_cents,
      'current_amount_cents', subscription_row.current_amount_cents,
      'items', previous_items
    )
  )
  on conflict (payment_id) do nothing;

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
        effective_at = coalesce(effective_at, target_period_start),
        updated_at = now()
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
      cancelled_at = null,
      metadata = case
        when legacy_vip_checkout then
          coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'legacy_vip_checkout_last_paid_at', coalesce(payment_row.paid_at, now()),
            'legacy_vip_checkout_last_amount_cents', payment_row.gross_amount_cents
          )
        else metadata
      end,
      updated_at = now()
  where id = target_subscription_id
  returning * into subscription_row;

  update public.subscription_billing_transitions
  set applied_state = jsonb_build_object(
        'status', subscription_row.status,
        'cycle_number', subscription_row.cycle_number,
        'current_period_start', subscription_row.current_period_start,
        'current_period_end', subscription_row.current_period_end,
        'next_due_at', subscription_row.next_due_at,
        'offer_id', subscription_row.offer_id,
        'amount_cents', subscription_row.amount_cents,
        'base_amount_cents', subscription_row.base_amount_cents,
        'current_amount_cents', subscription_row.current_amount_cents,
        'legacy_vip_checkout', legacy_vip_checkout
      ),
      updated_at = now()
  where payment_id = target_payment_id;

  return subscription_row;
end;
$function$;

create or replace function public.revert_prepaid_subscription_payment(
  target_payment_id uuid
)
returns table(
  subscription_id uuid,
  order_id uuid,
  reverted boolean,
  reason text
)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  payment_row public.payments;
  order_row public.orders;
  subscription_row public.subscriptions;
  transition_row public.subscription_billing_transitions;
  previous_state jsonb := '{}'::jsonb;
  previous_items jsonb := '[]'::jsonb;
  target_due_at timestamptz;
  previous_period_start timestamptz;
  previous_period_end timestamptz;
  previous_next_due_at timestamptz;
  previous_cancelled_at timestamptz;
  previous_status public.subscription_status;
  interval_name text;
  interval_count integer := 1;
  other_coverage boolean := false;
  replacement_payment uuid;
begin
  select * into payment_row
  from public.payments
  where id = target_payment_id
  for update;

  if not found then
    return query select null::uuid, null::uuid, false, 'payment_not_found'::text;
    return;
  end if;

  if payment_row.status not in ('refunded', 'charged_back') then
    return query select null::uuid, payment_row.order_id, false, 'payment_not_reversed'::text;
    return;
  end if;

  select * into order_row
  from public.orders
  where id = payment_row.order_id
  for update;

  if not found
     or order_row.subscription_id is null
     or order_row.billing_reason not in ('subscription_initial', 'subscription_renewal') then
    return query select order_row.subscription_id, payment_row.order_id, false, 'not_subscription_billing'::text;
    return;
  end if;

  select * into subscription_row
  from public.subscriptions
  where id = order_row.subscription_id
  for update;

  if not found then
    return query select order_row.subscription_id, order_row.id, false, 'subscription_not_found'::text;
    return;
  end if;

  select exists(
    select 1
    from public.subscriptions s2
    where s2.id <> subscription_row.id
      and s2.customer_id = subscription_row.customer_id
      and s2.product_id = subscription_row.product_id
      and s2.status = 'active'
      and coalesce(s2.current_period_end, now()) >=
          coalesce(subscription_row.current_period_end, now())
      and exists (
        select 1
        from public.orders o2
        join public.payments p2 on p2.order_id = o2.id
        where o2.subscription_id = s2.id
          and o2.billing_reason in ('subscription_initial', 'subscription_renewal')
          and p2.status = 'approved'
      )
  )
  into other_coverage;

  if other_coverage then
    return query select subscription_row.id, order_row.id, false, 'covered_by_other_subscription'::text;
    return;
  end if;

  select * into transition_row
  from public.subscription_billing_transitions
  where payment_id = target_payment_id
  for update;

  if found then
    if transition_row.reverted_at is not null then
      return query select subscription_row.id, order_row.id, false, 'already_reverted'::text;
      return;
    end if;

    if exists(
      select 1
      from public.subscription_billing_transitions newer
      where newer.subscription_id = subscription_row.id
        and newer.created_at > transition_row.created_at
        and newer.reverted_at is null
    ) then
      return query select subscription_row.id, order_row.id, false, 'newer_payment_applied'::text;
      return;
    end if;

    target_due_at :=
      nullif(transition_row.applied_state ->> 'current_period_start', '')::timestamptz;

    if order_row.billing_reason = 'subscription_renewal' and target_due_at is not null then
      select p2.id
      into replacement_payment
      from public.orders o2
      join public.payments p2 on p2.order_id = o2.id
      join public.subscription_checkout_sessions scs2 on scs2.order_id = o2.id
      where o2.subscription_id = subscription_row.id
        and o2.id <> order_row.id
        and o2.billing_reason = 'subscription_renewal'
        and p2.status = 'approved'
        and nullif(scs2.metadata ->> 'renewalDueAt', '')::timestamptz = target_due_at
      order by coalesce(p2.paid_at, p2.created_at), p2.id
      limit 1;

      if replacement_payment is not null then
        update public.subscription_billing_transitions
        set reverted_at = now(),
            reversal_status = payment_row.status::text,
            replacement_payment_id = replacement_payment,
            updated_at = now()
        where id = transition_row.id;

        return query select subscription_row.id, order_row.id, false, 'covered_by_other_payment'::text;
        return;
      end if;
    end if;

    previous_state := transition_row.previous_state;
    previous_items := coalesce(previous_state -> 'items', '[]'::jsonb);
    previous_period_start :=
      nullif(previous_state ->> 'current_period_start', '')::timestamptz;
    previous_period_end :=
      nullif(previous_state ->> 'current_period_end', '')::timestamptz;
    previous_next_due_at :=
      nullif(previous_state ->> 'next_due_at', '')::timestamptz;
    previous_cancelled_at :=
      nullif(previous_state ->> 'cancelled_at', '')::timestamptz;

    if order_row.billing_reason = 'subscription_initial' and previous_period_end is null then
      previous_status := 'past_due';
      previous_period_start := null;
      previous_period_end := coalesce(payment_row.paid_at, payment_row.created_at, now());
      previous_next_due_at := previous_period_end;

      update public.subscription_items
      set status = 'active',
          ended_at = null,
          updated_at = now()
      where subscription_id = subscription_row.id
        and status in ('pending', 'active');
    else
      previous_status :=
        coalesce(nullif(previous_state ->> 'status', ''), 'active')::public.subscription_status;

      if previous_period_end is not null and previous_period_end <= now() then
        previous_status := 'past_due';
      end if;

      if jsonb_typeof(previous_items) = 'array' then
        update public.subscription_items si
        set status = 'ended',
            ended_at = coalesce(si.ended_at, now()),
            updated_at = now()
        where si.subscription_id = subscription_row.id
          and si.status = 'active'
          and not exists (
            select 1
            from jsonb_array_elements(previous_items) item
            where nullif(item ->> 'id', '')::uuid = si.id
          );

        update public.subscription_items si
        set item_type = item ->> 'item_type',
            offer_id = nullif(item ->> 'offer_id', '')::uuid,
            addon_id = nullif(item ->> 'addon_id', '')::uuid,
            code = item ->> 'code',
            description = item ->> 'description',
            unit_amount_cents = (item ->> 'unit_amount_cents')::bigint,
            quantity = (item ->> 'quantity')::integer,
            status = coalesce(nullif(item ->> 'status', ''), 'active'),
            activated_at = nullif(item ->> 'activated_at', '')::timestamptz,
            ended_at = nullif(item ->> 'ended_at', '')::timestamptz,
            metadata = coalesce(item -> 'metadata', '{}'::jsonb),
            updated_at = now()
        from jsonb_array_elements(previous_items) item
        where si.subscription_id = subscription_row.id
          and si.id = nullif(item ->> 'id', '')::uuid;
      end if;
    end if;

    update public.subscriptions
    set status = previous_status,
        cycle_number = greatest(
          0,
          coalesce((previous_state ->> 'cycle_number')::integer, cycle_number - 1)
        ),
        current_period_start = previous_period_start,
        current_period_end = previous_period_end,
        next_due_at = coalesce(previous_next_due_at, previous_period_end),
        cancelled_at = case
          when previous_status in ('active', 'past_due') then null
          else previous_cancelled_at
        end,
        offer_id = coalesce(nullif(previous_state ->> 'offer_id', '')::uuid, offer_id),
        amount_cents = coalesce((previous_state ->> 'amount_cents')::bigint, amount_cents),
        base_amount_cents = coalesce((previous_state ->> 'base_amount_cents')::bigint, base_amount_cents),
        current_amount_cents = coalesce((previous_state ->> 'current_amount_cents')::bigint, current_amount_cents),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'last_payment_reversal', jsonb_build_object(
            'payment_id', target_payment_id,
            'order_id', order_row.id,
            'status', payment_row.status,
            'reverted_at', now()
          )
        ),
        updated_at = now()
    where id = subscription_row.id;

    update public.subscription_billing_transitions
    set reverted_at = now(),
        reversal_status = payment_row.status::text,
        updated_at = now()
    where id = transition_row.id;

    return query select subscription_row.id, order_row.id, true, 'reverted'::text;
    return;
  end if;

  if subscription_row.status in ('cancelled', 'expired') then
    return query select subscription_row.id, order_row.id, false, 'subscription_already_terminal'::text;
    return;
  end if;

  if order_row.billing_reason = 'subscription_renewal' then
    select nullif(scs.metadata ->> 'renewalDueAt', '')::timestamptz
    into target_due_at
    from public.subscription_checkout_sessions scs
    where scs.order_id = order_row.id
    limit 1;

    if target_due_at is null then
      return query select subscription_row.id, order_row.id, false, 'legacy_renewal_without_due_at'::text;
      return;
    end if;

    if subscription_row.current_period_start is not null
       and subscription_row.current_period_start > target_due_at + interval '1 minute' then
      return query select subscription_row.id, order_row.id, false, 'newer_period_already_applied'::text;
      return;
    end if;

    select p2.id
    into replacement_payment
    from public.orders o2
    join public.payments p2 on p2.order_id = o2.id
    join public.subscription_checkout_sessions scs2 on scs2.order_id = o2.id
    where o2.subscription_id = subscription_row.id
      and o2.id <> order_row.id
      and o2.billing_reason = 'subscription_renewal'
      and p2.status = 'approved'
      and nullif(scs2.metadata ->> 'renewalDueAt', '')::timestamptz = target_due_at
    order by coalesce(p2.paid_at, p2.created_at), p2.id
    limit 1;

    if replacement_payment is not null then
      return query select subscription_row.id, order_row.id, false, 'covered_by_other_payment'::text;
      return;
    end if;

    select o.billing_interval, greatest(1, coalesce(o.billing_interval_count, 1))
    into interval_name, interval_count
    from public.offers o
    where o.id = order_row.offer_id;

    previous_period_start := case
      when interval_name = 'week' then target_due_at - make_interval(days => interval_count * 7)
      when interval_name = 'year' then target_due_at - make_interval(years => interval_count)
      else target_due_at - make_interval(months => interval_count)
    end;

    previous_status := case
      when target_due_at <= now() then 'past_due'::public.subscription_status
      else 'active'::public.subscription_status
    end;

    update public.subscriptions
    set status = previous_status,
        cycle_number = greatest(0, cycle_number - 1),
        current_period_start = previous_period_start,
        current_period_end = target_due_at,
        next_due_at = target_due_at,
        cancelled_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'last_payment_reversal', jsonb_build_object(
            'payment_id', target_payment_id,
            'order_id', order_row.id,
            'status', payment_row.status,
            'reverted_at', now(),
            'legacy_fallback', true
          )
        ),
        updated_at = now()
    where id = subscription_row.id;

    return query select subscription_row.id, order_row.id, true, 'reverted_legacy_renewal'::text;
    return;
  end if;

  if exists(
    select 1
    from public.orders o2
    join public.payments p2 on p2.order_id = o2.id
    where o2.subscription_id = subscription_row.id
      and o2.id <> order_row.id
      and o2.billing_reason in ('subscription_initial', 'subscription_renewal')
      and p2.status = 'approved'
  ) then
    return query select subscription_row.id, order_row.id, false, 'newer_payment_exists'::text;
    return;
  end if;

  previous_period_end := coalesce(payment_row.paid_at, payment_row.created_at, now());

  update public.subscriptions
  set status = 'past_due',
      cycle_number = 0,
      current_period_start = null,
      current_period_end = previous_period_end,
      next_due_at = previous_period_end,
      cancelled_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'last_payment_reversal', jsonb_build_object(
          'payment_id', target_payment_id,
          'order_id', order_row.id,
          'status', payment_row.status,
          'reverted_at', now(),
          'legacy_fallback', true
        )
      ),
      updated_at = now()
  where id = subscription_row.id;

  return query select subscription_row.id, order_row.id, true, 'reverted_legacy_initial'::text;
end;
$function$;

revoke all on function public.revert_prepaid_subscription_payment(uuid)
  from public, anon, authenticated;
grant execute on function public.revert_prepaid_subscription_payment(uuid)
  to service_role;

commit;
