
begin;

alter table public.products
  add column if not exists billing_model text not null default 'prepaid';

alter table public.products
  drop constraint if exists products_billing_model_check,
  add constraint products_billing_model_check
    check (billing_model in ('prepaid', 'postpaid'));

alter table public.affiliate_programs
  add column if not exists commission_addons boolean not null default false,
  add column if not exists commission_prorated_changes boolean not null default false;

alter table public.subscriptions
  add column if not exists product_id uuid references public.products(id),
  add column if not exists billing_model text not null default 'prepaid',
  add column if not exists base_amount_cents bigint,
  add column if not exists current_amount_cents bigint,
  add column if not exists next_due_at timestamptz,
  add column if not exists affiliate_membership_id uuid references public.affiliate_memberships(id),
  add column if not exists affiliate_link_id uuid references public.affiliate_links(id),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update public.subscriptions s
set product_id = o.product_id
from public.orders o
where o.id = s.order_id
  and s.product_id is null;

update public.subscriptions
set base_amount_cents = coalesce(base_amount_cents, amount_cents),
    current_amount_cents = coalesce(current_amount_cents, amount_cents),
    next_due_at = coalesce(next_due_at, current_period_end)
where base_amount_cents is null
   or current_amount_cents is null
   or (next_due_at is null and current_period_end is not null);

alter table public.subscriptions
  alter column product_id set not null,
  alter column base_amount_cents set not null,
  alter column current_amount_cents set not null;

alter table public.subscriptions
  drop constraint if exists subscriptions_billing_model_check,
  add constraint subscriptions_billing_model_check check (billing_model in ('prepaid', 'postpaid')),
  drop constraint if exists subscriptions_base_amount_positive_check,
  add constraint subscriptions_base_amount_positive_check check (base_amount_cents > 0),
  drop constraint if exists subscriptions_current_amount_positive_check,
  add constraint subscriptions_current_amount_positive_check check (current_amount_cents > 0);

create index if not exists subscriptions_product_idx
  on public.subscriptions(product_id, status, created_at desc);
create index if not exists subscriptions_next_due_idx
  on public.subscriptions(next_due_at)
  where status in ('active', 'past_due');

create table public.product_addons (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  code text not null,
  name text not null check (char_length(trim(name)) between 2 and 180),
  description text,
  unit_amount_cents bigint not null check (unit_amount_cents > 0),
  currency char(3) not null default 'BRL' check (currency = upper(currency)),
  active boolean not null default true,
  max_quantity integer check (max_quantity is null or max_quantity > 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(product_id, code)
);
create index product_addons_product_idx on public.product_addons(product_id, active, created_at);

create table public.subscription_items (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  item_type text not null check (item_type in ('base', 'addon')),
  offer_id uuid references public.offers(id) on delete restrict,
  addon_id uuid references public.product_addons(id) on delete restrict,
  code text not null,
  description text not null,
  unit_amount_cents bigint not null check (unit_amount_cents > 0),
  quantity integer not null default 1 check (quantity > 0),
  status text not null default 'pending' check (status in ('pending', 'active', 'ended')),
  activated_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (item_type = 'base' and offer_id is not null and addon_id is null)
    or
    (item_type = 'addon' and offer_id is null and addon_id is not null)
  )
);
create unique index subscription_items_current_base_uq
  on public.subscription_items(subscription_id)
  where item_type = 'base' and status in ('pending', 'active');
create unique index subscription_items_current_addon_uq
  on public.subscription_items(subscription_id, addon_id)
  where item_type = 'addon' and status in ('pending', 'active');
create index subscription_items_subscription_idx
  on public.subscription_items(subscription_id, status);

insert into public.subscription_items(
  subscription_id, item_type, offer_id, code, description,
  unit_amount_cents, quantity, status, activated_at, ended_at
)
select
  s.id,
  'base',
  s.offer_id,
  o.checkout_slug,
  o.name,
  s.base_amount_cents,
  1,
  case when s.status in ('pending') then 'pending'
       when s.status in ('cancelled','expired') then 'ended'
       else 'active' end,
  case when s.status not in ('pending','cancelled','expired') then coalesce(s.current_period_start, s.created_at) end,
  case when s.status in ('cancelled','expired') then coalesce(s.cancelled_at, s.updated_at) end
from public.subscriptions s
join public.offers o on o.id = s.offer_id
where not exists (
  select 1 from public.subscription_items si
  where si.subscription_id = s.id and si.item_type = 'base'
);

create table public.subscription_changes (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  change_type text not null check (change_type in (
    'upgrade','downgrade','add_item','remove_item','increase_quantity','decrease_quantity'
  )),
  status text not null default 'quoted' check (status in (
    'quoted','awaiting_payment','payment_approved','scheduled','applying',
    'applied','expired','cancelled','failed'
  )),
  from_offer_id uuid references public.offers(id) on delete restrict,
  to_offer_id uuid references public.offers(id) on delete restrict,
  addon_id uuid references public.product_addons(id) on delete restrict,
  quantity_delta integer,
  quantity_before integer,
  quantity_after integer,
  base_amount_before_cents bigint,
  base_amount_after_cents bigint,
  current_amount_cents bigint not null check (current_amount_cents > 0),
  quoted_target_amount_cents bigint not null check (quoted_target_amount_cents > 0),
  applied_target_amount_cents bigint,
  proration_amount_cents bigint not null default 0 check (proration_amount_cents >= 0),
  commissionable_amount_cents bigint not null default 0 check (commissionable_amount_cents >= 0),
  effective_mode text not null check (effective_mode in (
    'immediately_after_payment','next_period_after_payment'
  )),
  effective_at timestamptz,
  quote_expires_at timestamptz,
  payment_order_id uuid,
  paid_at timestamptz,
  applied_at timestamptz,
  cancelled_at timestamptz,
  failure_reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (change_type in ('upgrade','downgrade') and to_offer_id is not null and addon_id is null)
    or
    (change_type in ('add_item','remove_item','increase_quantity','decrease_quantity')
      and addon_id is not null and quantity_delta is not null and quantity_delta <> 0)
  )
);
create index subscription_changes_subscription_idx
  on public.subscription_changes(subscription_id, status, created_at);
create index subscription_changes_quote_expiry_idx
  on public.subscription_changes(quote_expires_at)
  where status in ('quoted','awaiting_payment');

alter table public.orders
  add column if not exists subscription_id uuid references public.subscriptions(id) on delete restrict,
  add column if not exists subscription_change_id uuid references public.subscription_changes(id) on delete restrict,
  add column if not exists billing_reason text not null default 'purchase';

alter table public.orders
  drop constraint if exists orders_billing_reason_check,
  add constraint orders_billing_reason_check check (billing_reason in (
    'purchase','subscription_initial','subscription_renewal','subscription_change'
  ));

create index if not exists orders_subscription_idx
  on public.orders(subscription_id, created_at desc);
create index if not exists orders_subscription_change_idx
  on public.orders(subscription_change_id)
  where subscription_change_id is not null;

alter table public.subscription_changes
  add constraint subscription_changes_payment_order_fk
  foreign key (payment_order_id) references public.orders(id) on delete restrict;

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  subscription_id uuid references public.subscriptions(id) on delete restrict,
  subscription_item_id uuid references public.subscription_items(id) on delete restrict,
  line_type text not null check (line_type in ('base','addon','proration')),
  item_code text not null,
  description text not null,
  unit_amount_cents bigint not null check (unit_amount_cents >= 0),
  quantity integer not null default 1 check (quantity > 0),
  total_amount_cents bigint not null check (total_amount_cents >= 0),
  commissionable_amount_cents bigint not null default 0 check (
    commissionable_amount_cents >= 0 and commissionable_amount_cents <= total_amount_cents
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index order_items_order_idx on public.order_items(order_id);
create index order_items_subscription_idx on public.order_items(subscription_id, created_at desc)
  where subscription_id is not null;

create table public.subscription_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  subscription_change_id uuid references public.subscription_changes(id) on delete restrict,
  session_type text not null check (session_type in ('subscription_change','subscription_renewal')),
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'BRL',
  order_id uuid references public.orders(id) on delete restrict,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index subscription_checkout_sessions_subscription_idx
  on public.subscription_checkout_sessions(subscription_id, created_at desc);
create index subscription_checkout_sessions_expiry_idx
  on public.subscription_checkout_sessions(expires_at)
  where consumed_at is null;

alter table public.product_addons enable row level security;
alter table public.product_addons force row level security;
alter table public.subscription_items enable row level security;
alter table public.subscription_items force row level security;
alter table public.subscription_changes enable row level security;
alter table public.subscription_changes force row level security;
alter table public.order_items enable row level security;
alter table public.order_items force row level security;
alter table public.subscription_checkout_sessions enable row level security;
alter table public.subscription_checkout_sessions force row level security;

create policy product_addons_select_owner on public.product_addons
  for select to authenticated
  using (public.owns_product(product_id) or public.is_finance_admin());
create policy product_addons_insert_owner on public.product_addons
  for insert to authenticated
  with check (public.owns_product(product_id));
create policy product_addons_update_owner on public.product_addons
  for update to authenticated
  using (public.owns_product(product_id))
  with check (public.owns_product(product_id));
create policy product_addons_delete_owner on public.product_addons
  for delete to authenticated
  using (public.owns_product(product_id));

create policy subscription_items_select_related on public.subscription_items
  for select to authenticated
  using (
    exists (
      select 1 from public.subscriptions s
      where s.id = subscription_id
        and (public.owns_product(s.product_id) or public.is_finance_admin())
    )
  );

create policy subscription_changes_select_related on public.subscription_changes
  for select to authenticated
  using (
    exists (
      select 1 from public.subscriptions s
      where s.id = subscription_id
        and (public.owns_product(s.product_id) or public.is_finance_admin())
    )
  );

create policy order_items_select_related on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (o.producer_id = (select auth.uid()) or public.is_finance_admin())
    )
  );

grant select, insert, update, delete on public.product_addons to authenticated;
grant select on public.subscription_items, public.subscription_changes, public.order_items to authenticated;

create trigger product_addons_set_updated_at
  before update on public.product_addons
  for each row execute function public.set_updated_at();
create trigger subscription_items_set_updated_at
  before update on public.subscription_items
  for each row execute function public.set_updated_at();
create trigger subscription_changes_set_updated_at
  before update on public.subscription_changes
  for each row execute function public.set_updated_at();
create trigger subscription_checkout_sessions_set_updated_at
  before update on public.subscription_checkout_sessions
  for each row execute function public.set_updated_at();

create or replace function private.apply_subscription_change_state(target_change_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  change_row public.subscription_changes;
  subscription_row public.subscriptions;
  current_addon public.subscription_items;
  next_quantity integer;
  calculated_total bigint;
  active_base public.subscription_items;
begin
  select * into change_row
  from public.subscription_changes
  where id = target_change_id
  for update;

  if not found then raise exception 'subscription change not found'; end if;

  select * into subscription_row
  from public.subscriptions
  where id = change_row.subscription_id
  for update;

  if change_row.to_offer_id is not null then
    update public.subscription_items
    set status = 'ended', ended_at = now()
    where subscription_id = subscription_row.id
      and item_type = 'base'
      and status = 'active';

    insert into public.subscription_items(
      subscription_id, item_type, offer_id, code, description,
      unit_amount_cents, quantity, status, activated_at
    )
    select
      subscription_row.id, 'base', o.id, o.checkout_slug, o.name,
      change_row.base_amount_after_cents, 1, 'active', now()
    from public.offers o
    where o.id = change_row.to_offer_id;

    if not found then raise exception 'target offer not found'; end if;
  end if;

  if change_row.addon_id is not null then
    select * into current_addon
    from public.subscription_items
    where subscription_id = subscription_row.id
      and addon_id = change_row.addon_id
      and status = 'active'
    for update;

    next_quantity := greatest(0, coalesce(current_addon.quantity, 0) + change_row.quantity_delta);

    if next_quantity = 0 then
      if current_addon.id is not null then
        update public.subscription_items
        set status = 'ended', ended_at = now()
        where id = current_addon.id;
      end if;
    elsif current_addon.id is not null then
      update public.subscription_items
      set quantity = next_quantity
      where id = current_addon.id;
    else
      insert into public.subscription_items(
        subscription_id, item_type, addon_id, code, description,
        unit_amount_cents, quantity, status, activated_at
      )
      select
        subscription_row.id, 'addon', a.id, a.code, a.name,
        a.unit_amount_cents, next_quantity, 'active', now()
      from public.product_addons a
      where a.id = change_row.addon_id and a.active;
      if not found then raise exception 'addon not found or inactive'; end if;
    end if;
  end if;

  select * into active_base
  from public.subscription_items
  where subscription_id = subscription_row.id
    and item_type = 'base'
    and status = 'active'
  limit 1;

  if active_base.id is null then raise exception 'active base item not found'; end if;

  select coalesce(sum(unit_amount_cents * quantity), 0)::bigint
  into calculated_total
  from public.subscription_items
  where subscription_id = subscription_row.id
    and status = 'active';

  if calculated_total <= 0 then raise exception 'invalid subscription total'; end if;

  update public.subscriptions
  set offer_id = active_base.offer_id,
      base_amount_cents = active_base.unit_amount_cents,
      current_amount_cents = calculated_total,
      amount_cents = calculated_total
  where id = subscription_row.id;

  update public.subscription_changes
  set status = 'applied',
      applied_target_amount_cents = calculated_total,
      applied_at = now(),
      failure_reason = null
  where id = target_change_id;

  return calculated_total;
end;
$$;

revoke all on function private.apply_subscription_change_state(uuid)
  from public, anon, authenticated;

create or replace function public.activate_prepaid_subscription(
  target_subscription_id uuid,
  target_payment_id uuid,
  target_period_start timestamptz,
  target_period_end timestamptz
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments;
  subscription_row public.subscriptions;
begin
  select p.* into payment_row
  from public.payments p
  join public.orders o on o.id = p.order_id
  where p.id = target_payment_id
    and p.status = 'approved'
    and o.subscription_id = target_subscription_id
    and o.billing_reason = 'subscription_initial'
  for update of p;

  if not found then raise exception 'approved initial subscription payment not found'; end if;

  select * into subscription_row
  from public.subscriptions
  where id = target_subscription_id
  for update;

  if not found then raise exception 'subscription not found'; end if;

  update public.subscription_items
  set status = 'active',
      activated_at = coalesce(activated_at, target_period_start)
  where subscription_id = target_subscription_id
    and status = 'pending';

  update public.subscriptions
  set status = 'active',
      cycle_number = greatest(1, cycle_number),
      current_period_start = target_period_start,
      current_period_end = target_period_end,
      next_due_at = target_period_end,
      amount_cents = current_amount_cents
  where id = target_subscription_id
  returning * into subscription_row;

  return subscription_row;
end;
$$;
revoke all on function public.activate_prepaid_subscription(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.activate_prepaid_subscription(uuid, uuid, timestamptz, timestamptz)
  to service_role;

create or replace function public.apply_paid_subscription_change(
  target_change_id uuid,
  target_payment_id uuid
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  change_row public.subscription_changes;
  payment_row public.payments;
  total bigint;
begin
  select * into change_row
  from public.subscription_changes
  where id = target_change_id
  for update;

  if not found then raise exception 'subscription change not found'; end if;
  if change_row.effective_mode <> 'immediately_after_payment' then
    raise exception 'change is not immediate';
  end if;
  if change_row.status = 'applied' then
    return coalesce(change_row.applied_target_amount_cents, change_row.quoted_target_amount_cents);
  end if;

  select p.* into payment_row
  from public.payments p
  join public.orders o on o.id = p.order_id
  where p.id = target_payment_id
    and p.status = 'approved'
    and o.subscription_change_id = target_change_id
    and o.subscription_id = change_row.subscription_id
    and o.billing_reason = 'subscription_change'
  for update of p;

  if not found then raise exception 'approved change payment not found'; end if;

  update public.subscription_changes
  set status = 'applying',
      paid_at = coalesce(paid_at, payment_row.paid_at, now())
  where id = target_change_id;

  total := private.apply_subscription_change_state(target_change_id);
  return total;
end;
$$;
revoke all on function public.apply_paid_subscription_change(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_paid_subscription_change(uuid, uuid)
  to service_role;

create or replace function public.apply_prepaid_subscription_renewal(
  target_subscription_id uuid,
  target_payment_id uuid,
  target_period_start timestamptz,
  target_period_end timestamptz
)
returns public.subscriptions
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_row public.payments;
  subscription_row public.subscriptions;
  change_row public.subscription_changes;
  calculated_total bigint;
begin
  select p.* into payment_row
  from public.payments p
  join public.orders o on o.id = p.order_id
  where p.id = target_payment_id
    and p.status = 'approved'
    and o.subscription_id = target_subscription_id
    and o.billing_reason = 'subscription_renewal'
  for update of p;

  if not found then raise exception 'approved renewal payment not found'; end if;

  select * into subscription_row
  from public.subscriptions
  where id = target_subscription_id
  for update;

  if not found then raise exception 'subscription not found'; end if;

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

  if calculated_total <> payment_row.gross_amount_cents then
    raise exception 'renewal amount does not match active subscription items';
  end if;

  update public.subscriptions
  set status = 'active',
      cycle_number = cycle_number + 1,
      current_period_start = target_period_start,
      current_period_end = target_period_end,
      next_due_at = target_period_end,
      current_amount_cents = calculated_total,
      amount_cents = calculated_total
  where id = target_subscription_id
  returning * into subscription_row;

  return subscription_row;
end;
$$;
revoke all on function public.apply_prepaid_subscription_renewal(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_prepaid_subscription_renewal(uuid, uuid, timestamptz, timestamptz)
  to service_role;

comment on column public.products.billing_model is
  'Billing timing for subscription products. Current production model is prepaid; postpaid is reserved for future recurring billing.';
comment on column public.affiliate_programs.commission_addons is
  'When true, active subscription add-ons are included in the affiliate commission base on full-cycle charges.';
comment on column public.affiliate_programs.commission_prorated_changes is
  'When true, eligible mid-cycle prorated subscription changes may generate affiliate commission.';
comment on table public.subscription_changes is
  'Immutable-intent audit trail for upgrades, downgrades and add-on quantity changes. Reductions are scheduled for the next prepaid renewal.';
comment on table public.order_items is
  'Financial line-item snapshot for a charge, including the exact commissionable base per item.';

commit;
