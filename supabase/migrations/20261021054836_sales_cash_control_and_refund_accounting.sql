create index if not exists payments_approved_paid_at_idx
  on public.payments (paid_at)
  where status = 'approved'::public.payment_status;

create index if not exists withdrawals_paid_paid_at_idx
  on public.withdrawals (paid_at)
  where status = 'paid'::public.withdrawal_status;

-- Repara estornos processados pelo webhook de Order antes da rotina compartilhada.
with reversal_groups as (
  select
    le.account_id,
    le.order_id,
    le.payment_id,
    le.settlement_model,
    le.currency,
    p.status::text as payment_status,
    p.external_payment_id,
    sum(le.amount_cents)::bigint as positive_amount_cents,
    array_agg(le.id order by le.created_at, le.id) as reversed_entry_ids
  from public.ledger_entries le
  join public.payments p on p.id = le.payment_id
  where p.status::text in ('refunded', 'charged_back')
    and le.status::text = 'posted'
    and le.amount_cents > 0
  group by
    le.account_id,
    le.order_id,
    le.payment_id,
    le.settlement_model,
    le.currency,
    p.status::text,
    p.external_payment_id
)
insert into public.ledger_entries (
  account_id,
  order_id,
  payment_id,
  settlement_model,
  entry_type,
  amount_cents,
  currency,
  available_at,
  source_type,
  source_id,
  reference,
  metadata
)
select
  rg.account_id,
  rg.order_id,
  rg.payment_id,
  rg.settlement_model,
  case
    when rg.payment_status = 'refunded' then 'refund'::public.ledger_entry_type
    else 'chargeback'::public.ledger_entry_type
  end,
  -rg.positive_amount_cents,
  rg.currency,
  now(),
  case when rg.payment_status = 'refunded' then 'refund' else 'chargeback' end,
  rg.payment_id,
  concat(
    case when rg.payment_status = 'refunded' then 'refund:' else 'chargeback:' end,
    coalesce(rg.external_payment_id, rg.payment_id::text)
  ),
  jsonb_build_object(
    'reversesEntryIds',
    to_jsonb(rg.reversed_entry_ids),
    'backfill',
    true,
    'reason',
    'transparent_order_payment_reversal'
  )
from reversal_groups rg
on conflict (account_id, source_type, source_id, entry_type) do nothing;

update public.commissions c
set
  status = 'reversed'::public.commission_status,
  reversed_at = coalesce(c.reversed_at, now()),
  updated_at = now()
from public.payments p
where p.id = c.payment_id
  and p.status::text in ('refunded', 'charged_back')
  and c.status::text not in ('cancelled', 'reversed');

create or replace function public.get_platform_dashboard_totals()
returns table(
  sales_count bigint,
  volume_cents bigint,
  product_revenue_cents bigint,
  ticket_average_cents bigint,
  available_cents bigint,
  pending_cents bigint,
  withdrawals_cents bigint,
  prosperity_fee_cents bigint,
  affiliate_commission_cents bigint,
  accredited_commission_cents bigint,
  coproducer_commission_cents bigint,
  total_commission_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_finance_admin() then
    raise exception 'Acesso administrativo necessario.';
  end if;

  return query
  with approved_payments as (
    select distinct on (p.order_id)
      p.id,
      p.order_id,
      p.gross_amount_cents,
      p.provider_fee_amount_cents,
      p.paid_at,
      p.created_at
    from public.payments p
    where p.status::text = 'approved'
      and coalesce(p.raw_provider_data -> 'prosperity_hidden_test', 'false'::jsonb) <> 'true'::jsonb
    order by p.order_id, p.paid_at desc nulls last, p.created_at desc
  ),
  approved_orders as (
    select
      o.id,
      o.producer_id,
      o.settlement_model,
      ap.provider_fee_amount_cents
    from public.orders o
    join approved_payments ap on ap.order_id = o.id
  ),
  producer_ledger as (
    select
      ao.id as order_id,
      coalesce(sum(le.amount_cents) filter (
        where le.status::text = 'posted'
          and le.entry_type::text in ('sale_credit','gateway_fee','refund','chargeback','adjustment')
      ), 0)::bigint as ledger_net_cents,
      coalesce(bool_or(
        le.status::text = 'posted'
        and le.entry_type::text = 'sale_credit'
      ), false) as has_sale_credit
    from approved_orders ao
    left join public.ledger_accounts la
      on la.user_id = ao.producer_id
     and la.account_type::text = 'user_balance'
    left join public.ledger_entries le
      on le.account_id = la.id
     and le.order_id = ao.id
    group by ao.id
  ),
  product_revenue as (
    select coalesce(sum(
      case
        when pl.has_sale_credit then pl.ledger_net_cents
        else coalesce(fs.producer_amount_cents, 0) - coalesce(ao.provider_fee_amount_cents, 0)
      end
    ), 0)::bigint as total_cents
    from approved_orders ao
    left join producer_ledger pl on pl.order_id = ao.id
    left join public.financial_snapshots fs on fs.order_id = ao.id
  ),
  balances as (
    select
      coalesce(sum(ubs.available_cents), 0)::bigint as available_cents,
      coalesce(sum(ubs.pending_cents), 0)::bigint as pending_cents
    from public.user_balance_summary ubs
  ),
  paid_withdrawals as (
    select coalesce(sum(w.amount_cents), 0)::bigint as total_cents
    from public.withdrawals w
    where w.status::text = 'paid'
  ),
  platform_fees as (
    select coalesce(sum(le.amount_cents), 0)::bigint as total_cents
    from public.ledger_entries le
    join public.ledger_accounts la on la.id = le.account_id
    join approved_payments ap on ap.id = le.payment_id
    where la.account_type::text = 'platform_revenue'
      and le.status::text = 'posted'
  ),
  commission_totals as (
    select
      coalesce(sum(c.amount_cents) filter (
        where c.commission_type::text = 'affiliate'
          and coalesce(am.partner_type::text, 'affiliate') <> 'accredited'
      ), 0)::bigint as affiliate_cents,
      coalesce(sum(c.amount_cents) filter (
        where c.commission_type::text = 'affiliate'
          and am.partner_type::text = 'accredited'
      ), 0)::bigint as accredited_cents,
      coalesce(sum(c.amount_cents) filter (
        where c.commission_type::text = 'coproducer'
      ), 0)::bigint as coproducer_cents
    from public.commissions c
    join approved_payments ap on ap.id = c.payment_id
    join public.orders o on o.id = ap.order_id
    left join public.affiliate_attributions aa on aa.order_id = o.id
    left join public.affiliate_memberships am on am.id = aa.affiliate_membership_id
    where c.status::text not in ('cancelled','reversed')
  ),
  payment_totals as (
    select
      count(*)::bigint as sales_count,
      coalesce(sum(ap.gross_amount_cents), 0)::bigint as volume_cents
    from approved_payments ap
  )
  select
    pt.sales_count,
    pt.volume_cents,
    pr.total_cents,
    case
      when pt.sales_count > 0 then round(pt.volume_cents::numeric / pt.sales_count)::bigint
      else 0::bigint
    end,
    b.available_cents,
    b.pending_cents,
    pw.total_cents,
    pf.total_cents,
    ct.affiliate_cents,
    ct.accredited_cents,
    ct.coproducer_cents,
    (ct.affiliate_cents + ct.accredited_cents + ct.coproducer_cents)::bigint
  from payment_totals pt
  cross join product_revenue pr
  cross join balances b
  cross join paid_withdrawals pw
  cross join platform_fees pf
  cross join commission_totals ct;
end;
$function$;

create or replace function public.get_sales_cash_control_totals(
  target_month date,
  target_day integer default null,
  target_hour integer default null
)
returns table(
  sales_count bigint,
  volume_cents bigint,
  product_revenue_cents bigint,
  ticket_average_cents bigint,
  available_cents bigint,
  pending_cents bigint,
  withdrawals_cents bigint,
  prosperity_fee_cents bigint,
  provider_fee_cents bigint,
  affiliate_commission_cents bigint,
  accredited_commission_cents bigint,
  coproducer_commission_cents bigint,
  total_commission_cents bigint
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  actor_user_id uuid := auth.uid();
  is_platform_admin boolean := false;
  month_start date;
  period_start_local timestamp without time zone;
  period_end_local timestamp without time zone;
  period_start_at timestamp with time zone;
  period_end_at timestamp with time zone;
  last_day integer;
begin
  if actor_user_id is null then
    raise exception 'Autenticacao obrigatoria.';
  end if;

  if target_month is null then
    raise exception 'Mes obrigatorio.';
  end if;

  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = actor_user_id
      and ur.role::text = 'admin'
  ) into is_platform_admin;

  month_start := date_trunc('month', target_month)::date;
  last_day := extract(day from (month_start + interval '1 month - 1 day'))::integer;

  if target_day is not null and (target_day < 1 or target_day > last_day) then
    raise exception 'Dia invalido para o mes selecionado.';
  end if;

  if target_hour is not null and (target_hour < 0 or target_hour > 23) then
    raise exception 'Hora invalida.';
  end if;

  if target_day is null then
    period_start_local := month_start::timestamp;
    period_end_local := (month_start + interval '1 month')::timestamp;
  else
    period_start_local := make_date(
      extract(year from month_start)::integer,
      extract(month from month_start)::integer,
      target_day
    )::timestamp;
    period_end_local := period_start_local + interval '1 day';
  end if;

  period_start_at := period_start_local at time zone 'America/Sao_Paulo';
  period_end_at := period_end_local at time zone 'America/Sao_Paulo';

  return query
  with approved_payments as (
    select distinct on (p.order_id)
      p.id,
      p.order_id,
      p.gross_amount_cents,
      p.provider_fee_amount_cents,
      p.paid_at
    from public.payments p
    join public.orders o on o.id = p.order_id
    where p.status::text = 'approved'
      and p.paid_at is not null
      and p.paid_at >= period_start_at
      and p.paid_at < period_end_at
      and (
        target_hour is null
        or extract(hour from (p.paid_at at time zone 'America/Sao_Paulo'))::integer = target_hour
      )
      and (is_platform_admin or o.producer_id = actor_user_id)
      and coalesce(p.raw_provider_data -> 'prosperity_hidden_test', 'false'::jsonb) <> 'true'::jsonb
    order by p.order_id, p.paid_at desc, p.created_at desc
  ),
  selected_orders as (
    select
      o.id,
      o.producer_id,
      o.settlement_model,
      ap.provider_fee_amount_cents
    from public.orders o
    join approved_payments ap on ap.order_id = o.id
  ),
  producer_ledger as (
    select
      so.id as order_id,
      coalesce(sum(le.amount_cents) filter (
        where le.status::text = 'posted'
          and le.entry_type::text in ('sale_credit','gateway_fee','refund','chargeback','adjustment')
      ), 0)::bigint as ledger_net_cents,
      coalesce(bool_or(
        le.status::text = 'posted'
        and le.entry_type::text = 'sale_credit'
      ), false) as has_sale_credit
    from selected_orders so
    left join public.ledger_accounts la
      on la.user_id = so.producer_id
     and la.account_type::text = 'user_balance'
    left join public.ledger_entries le
      on le.account_id = la.id
     and le.order_id = so.id
    group by so.id
  ),
  product_revenue as (
    select coalesce(sum(
      case
        when pl.has_sale_credit then pl.ledger_net_cents
        else coalesce(fs.producer_amount_cents, 0) - coalesce(so.provider_fee_amount_cents, 0)
      end
    ), 0)::bigint as total_cents
    from selected_orders so
    left join producer_ledger pl on pl.order_id = so.id
    left join public.financial_snapshots fs on fs.order_id = so.id
  ),
  balances as (
    select
      coalesce(sum(ubs.available_cents), 0)::bigint as available_cents,
      coalesce(sum(ubs.pending_cents), 0)::bigint as pending_cents
    from public.user_balance_summary ubs
    where is_platform_admin or ubs.user_id = actor_user_id
  ),
  paid_withdrawals as (
    select coalesce(sum(w.amount_cents), 0)::bigint as total_cents
    from public.withdrawals w
    where w.status::text = 'paid'
      and w.paid_at is not null
      and w.paid_at >= period_start_at
      and w.paid_at < period_end_at
      and (
        target_hour is null
        or extract(hour from (w.paid_at at time zone 'America/Sao_Paulo'))::integer = target_hour
      )
      and (is_platform_admin or w.user_id = actor_user_id)
  ),
  platform_fee_total as (
    select coalesce(sum(le.amount_cents), 0)::bigint as total_cents
    from public.ledger_entries le
    join public.ledger_accounts la on la.id = le.account_id
    join approved_payments ap on ap.id = le.payment_id
    where la.account_type::text = 'platform_revenue'
      and le.status::text = 'posted'
  ),
  producer_fee_total as (
    select coalesce(sum(fs.prosperity_fee_amount_cents), 0)::bigint as total_cents
    from selected_orders so
    left join public.financial_snapshots fs on fs.order_id = so.id
  ),
  provider_fees as (
    select coalesce(sum(ap.provider_fee_amount_cents), 0)::bigint as total_cents
    from approved_payments ap
  ),
  commission_totals as (
    select
      coalesce(sum(c.amount_cents) filter (
        where c.commission_type::text = 'affiliate'
          and coalesce(am.partner_type::text, 'affiliate') <> 'accredited'
      ), 0)::bigint as affiliate_cents,
      coalesce(sum(c.amount_cents) filter (
        where c.commission_type::text = 'affiliate'
          and am.partner_type::text = 'accredited'
      ), 0)::bigint as accredited_cents,
      coalesce(sum(c.amount_cents) filter (
        where c.commission_type::text = 'coproducer'
      ), 0)::bigint as coproducer_cents
    from public.commissions c
    join approved_payments ap on ap.id = c.payment_id
    join public.orders o on o.id = ap.order_id
    left join public.affiliate_attributions aa on aa.order_id = o.id
    left join public.affiliate_memberships am on am.id = aa.affiliate_membership_id
    where c.status::text not in ('cancelled','reversed')
  ),
  payment_totals as (
    select
      count(*)::bigint as sales_count,
      coalesce(sum(ap.gross_amount_cents), 0)::bigint as volume_cents
    from approved_payments ap
  )
  select
    pt.sales_count,
    pt.volume_cents,
    pr.total_cents,
    case
      when pt.sales_count > 0 then round(pt.volume_cents::numeric / pt.sales_count)::bigint
      else 0::bigint
    end,
    b.available_cents,
    b.pending_cents,
    pw.total_cents,
    case when is_platform_admin then pft.total_cents else uft.total_cents end,
    pvf.total_cents,
    ct.affiliate_cents,
    ct.accredited_cents,
    ct.coproducer_cents,
    (ct.affiliate_cents + ct.accredited_cents + ct.coproducer_cents)::bigint
  from payment_totals pt
  cross join product_revenue pr
  cross join balances b
  cross join paid_withdrawals pw
  cross join platform_fee_total pft
  cross join producer_fee_total uft
  cross join provider_fees pvf
  cross join commission_totals ct;
end;
$function$;

revoke all on function public.get_sales_cash_control_totals(date, integer, integer) from public;
revoke all on function public.get_sales_cash_control_totals(date, integer, integer) from anon;
grant execute on function public.get_sales_cash_control_totals(date, integer, integer) to authenticated;
