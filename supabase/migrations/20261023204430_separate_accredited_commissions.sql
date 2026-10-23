alter table public.financial_allocations
  drop constraint if exists financial_allocations_check;

alter table public.financial_allocations
  add constraint financial_allocations_check
  check (
    (
      allocation_type = any (
        array[
          'producer'::public.allocation_type,
          'affiliate'::public.allocation_type,
          'accredited'::public.allocation_type,
          'coproducer'::public.allocation_type
        ]
      )
      and beneficiary_user_id is not null
    )
    or
    (
      allocation_type = any (
        array[
          'prosperity_fee'::public.allocation_type,
          'gateway_fee'::public.allocation_type
        ]
      )
      and beneficiary_user_id is null
    )
  );

alter table public.commissions
  drop constraint if exists commissions_commission_type_check;

alter table public.commissions
  add constraint commissions_commission_type_check
  check (
    commission_type = any (
      array[
        'affiliate'::public.allocation_type,
        'accredited'::public.allocation_type,
        'coproducer'::public.allocation_type
      ]
    )
  );

create or replace function public.normalize_partner_financial_allocation()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_order_id uuid;
  v_product_id uuid;
  v_partner_type text;
begin
  if new.allocation_type <> 'affiliate'::public.allocation_type
     or new.beneficiary_user_id is null then
    return new;
  end if;

  select fs.order_id, o.product_id
    into v_order_id, v_product_id
  from public.financial_snapshots fs
  join public.orders o on o.id = fs.order_id
  where fs.id = new.snapshot_id;

  if v_order_id is not null then
    select am.partner_type::text
      into v_partner_type
    from public.affiliate_attributions aa
    join public.affiliate_memberships am
      on am.id = aa.affiliate_membership_id
    where aa.order_id = v_order_id
      and am.user_id = new.beneficiary_user_id
    order by aa.attributed_at desc
    limit 1;
  end if;

  if v_partner_type is null then
    v_partner_type := nullif(
      coalesce(
        new.rule_snapshot ->> 'partner_type',
        new.rule_snapshot ->> 'partnerType'
      ),
      ''
    );
  end if;

  if v_partner_type is null and v_product_id is not null then
    select case
      when count(distinct am.partner_type::text) = 1
        then min(am.partner_type::text)
      else null
    end
      into v_partner_type
    from public.affiliate_memberships am
    join public.affiliate_programs ap on ap.id = am.program_id
    where am.user_id = new.beneficiary_user_id
      and ap.product_id = v_product_id
      and am.status::text = 'active';
  end if;

  if v_partner_type = 'accredited' then
    new.allocation_type := 'accredited'::public.allocation_type;
    new.rule_snapshot :=
      coalesce(new.rule_snapshot, '{}'::jsonb)
      || jsonb_build_object('partner_type', 'accredited');
  end if;

  return new;
end;
$function$;

drop trigger if exists normalize_partner_financial_allocation
  on public.financial_allocations;

create trigger normalize_partner_financial_allocation
before insert or update of allocation_type, beneficiary_user_id, snapshot_id
on public.financial_allocations
for each row
execute function public.normalize_partner_financial_allocation();

create or replace function public.post_payment_financials(target_payment_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  payment_row public.payments;
  allocation_row public.financial_allocations;
  snapshot_row public.financial_snapshots;
  account_id_value uuid;
  inserted_count integer := 0;
  available_time timestamptz;
  mapped_type public.ledger_entry_type;
begin
  select *
    into payment_row
  from public.payments
  where id = target_payment_id
    and status = 'approved'
  for update;

  if not found then
    raise exception 'approved payment not found';
  end if;

  select fs.*
    into snapshot_row
  from public.financial_snapshots fs
  where fs.order_id = payment_row.order_id;

  for allocation_row in
    select *
    from public.financial_allocations
    where snapshot_id = snapshot_row.id
      and amount_cents > 0
  loop
    if allocation_row.destination in ('connected_account', 'gateway') then
      continue;
    end if;

    if allocation_row.beneficiary_user_id is not null then
      insert into public.ledger_accounts(account_type, user_id, currency)
      values ('user_balance', allocation_row.beneficiary_user_id, allocation_row.currency)
      on conflict do nothing;

      select id
        into account_id_value
      from public.ledger_accounts
      where user_id = allocation_row.beneficiary_user_id
        and currency = allocation_row.currency;
    elsif allocation_row.allocation_type = 'prosperity_fee' then
      insert into public.ledger_accounts(account_type, currency)
      values ('platform_revenue', allocation_row.currency)
      on conflict do nothing;

      select id
        into account_id_value
      from public.ledger_accounts
      where account_type = 'platform_revenue'
        and user_id is null
        and currency = allocation_row.currency;
    else
      continue;
    end if;

    mapped_type := case allocation_row.allocation_type
      when 'producer' then 'sale_credit'::public.ledger_entry_type
      when 'affiliate' then 'affiliate_commission'::public.ledger_entry_type
      when 'accredited' then 'accredited_commission'::public.ledger_entry_type
      when 'coproducer' then 'coproducer_commission'::public.ledger_entry_type
      when 'prosperity_fee' then 'prosperity_fee'::public.ledger_entry_type
      else 'adjustment'::public.ledger_entry_type
    end;

    available_time := case
      when allocation_row.allocation_type in ('affiliate', 'accredited', 'coproducer')
        then coalesce(payment_row.paid_at, now()) + interval '7 days'
      else now()
    end;

    insert into public.ledger_entries(
      account_id, order_id, payment_id, settlement_model, entry_type,
      amount_cents, currency, available_at, source_type, source_id, reference
    ) values (
      account_id_value, payment_row.order_id, payment_row.id,
      snapshot_row.settlement_model, mapped_type,
      allocation_row.amount_cents, allocation_row.currency, available_time,
      'allocation', allocation_row.id, 'payment:' || payment_row.id
    )
    on conflict do nothing;

    if found then
      inserted_count := inserted_count + 1;
    end if;

    if allocation_row.allocation_type in ('affiliate', 'accredited', 'coproducer') then
      insert into public.commissions(
        allocation_id, payment_id, beneficiary_user_id, commission_type,
        amount_cents, currency, available_at
      ) values (
        allocation_row.id, payment_row.id, allocation_row.beneficiary_user_id,
        allocation_row.allocation_type, allocation_row.amount_cents,
        allocation_row.currency, available_time
      )
      on conflict (allocation_id) do nothing;
    end if;
  end loop;

  if snapshot_row.settlement_model = 'prosperity_balance'
     and payment_row.provider_fee_amount_cents > 0 then
    insert into public.ledger_accounts(account_type, user_id, currency)
      select 'user_balance', ord.producer_id, payment_row.currency
      from public.orders ord
      where ord.id = payment_row.order_id
    on conflict do nothing;

    select la.id
      into account_id_value
    from public.ledger_accounts la
    join public.orders ord on ord.producer_id = la.user_id
    where ord.id = payment_row.order_id
      and la.currency = payment_row.currency;

    insert into public.ledger_entries(
      account_id, order_id, payment_id, settlement_model, entry_type,
      amount_cents, currency, source_type, source_id, reference, metadata
    ) values (
      account_id_value, payment_row.order_id, payment_row.id,
      snapshot_row.settlement_model, 'gateway_fee',
      -payment_row.provider_fee_amount_cents, payment_row.currency,
      'payment_gateway_fee', payment_row.id,
      'gateway_fee:' || payment_row.id,
      jsonb_build_object('observed_fee_cents', payment_row.provider_fee_amount_cents)
    )
    on conflict do nothing;
  end if;

  return inserted_count;
end;
$function$;

do $block$
declare
  v_function regprocedure;
  v_definition text;
  v_old text :=
    'where cr.commission_type = ''affiliate''' || chr(10) ||
    '          and cr.partner_type = ''accredited''';
  v_new text :=
    'where (cr.commission_type = ''accredited''' || chr(10) ||
    '          or (cr.commission_type = ''affiliate''' || chr(10) ||
    '            and cr.partner_type = ''accredited''))';
begin
  foreach v_function in array array[
    'public.get_platform_dashboard_totals()'::regprocedure,
    'public.get_sales_cash_control_range_totals(uuid,timestamp with time zone,timestamp with time zone)'::regprocedure,
    'public.get_sales_cash_control_totals(date,integer,integer)'::regprocedure
  ]
  loop
    select pg_get_functiondef(v_function) into v_definition;
    if position(v_old in v_definition) > 0 then
      execute replace(v_definition, v_old, v_new);
    end if;
  end loop;
end;
$block$;

alter table public.financial_allocations
  disable trigger financial_allocations_immutable;
alter table public.ledger_entries
  disable trigger ledger_entries_immutable;

with targets as (
  select id
  from public.profiles
  where lower(email) in (
    'adenilsonluna@gmail.com',
    'emersonluizprado@outlook.com'
  )
)
update public.financial_allocations fa
set allocation_type = 'accredited'::public.allocation_type,
    rule_snapshot =
      coalesce(fa.rule_snapshot, '{}'::jsonb)
      || jsonb_build_object(
        'partner_type', 'accredited',
        'classification_migrated_at', now()
      )
where fa.beneficiary_user_id in (select id from targets)
  and fa.allocation_type = 'affiliate'::public.allocation_type;

with targets as (
  select id
  from public.profiles
  where lower(email) in (
    'adenilsonluna@gmail.com',
    'emersonluizprado@outlook.com'
  )
)
update public.commissions c
set commission_type = 'accredited'::public.allocation_type
where c.beneficiary_user_id in (select id from targets)
  and c.commission_type = 'affiliate'::public.allocation_type;

with targets as (
  select id
  from public.profiles
  where lower(email) in (
    'adenilsonluna@gmail.com',
    'emersonluizprado@outlook.com'
  )
)
update public.ledger_entries le
set entry_type = 'accredited_commission'::public.ledger_entry_type
from public.ledger_accounts la
where le.account_id = la.id
  and la.user_id in (select id from targets)
  and le.entry_type = 'affiliate_commission'::public.ledger_entry_type;

alter table public.financial_allocations
  enable trigger financial_allocations_immutable;
alter table public.ledger_entries
  enable trigger ledger_entries_immutable;

do $block$
declare
  v_function regprocedure := 'public.get_sales_cash_control_totals(date,integer,integer)'::regprocedure;
  v_definition text;
  v_old text :=
    'where c.commission_type::text = ''affiliate''' || chr(10) ||
    '          and am.partner_type::text = ''accredited''';
  v_new text :=
    'where c.commission_type::text = ''accredited''' || chr(10) ||
    '          or (c.commission_type::text = ''affiliate''' || chr(10) ||
    '          and am.partner_type::text = ''accredited'')';
begin
  select pg_get_functiondef(v_function) into v_definition;
  if position(v_old in v_definition) > 0 then
    execute replace(v_definition, v_old, v_new);
  end if;
end;
$block$;
