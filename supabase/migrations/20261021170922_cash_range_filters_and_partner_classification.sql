CREATE OR REPLACE FUNCTION public.get_platform_dashboard_totals()
 RETURNS TABLE(sales_count bigint, volume_cents bigint, product_revenue_cents bigint, ticket_average_cents bigint, available_cents bigint, pending_cents bigint, withdrawals_cents bigint, prosperity_fee_cents bigint, affiliate_commission_cents bigint, accredited_commission_cents bigint, coproducer_commission_cents bigint, total_commission_cents bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
        else
          coalesce(fs.producer_amount_cents, 0)
          - coalesce(ao.provider_fee_amount_cents, 0)
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
  commission_rows as (
    select
      c.amount_cents,
      c.commission_type::text as commission_type,
      coalesce(
        am.partner_type::text,
        (
          select am2.partner_type::text
          from public.affiliate_memberships am2
          join public.affiliate_programs ap2 on ap2.id = am2.program_id
          where am2.user_id = c.beneficiary_user_id
            and ap2.product_id = o.product_id
          order by
            case when am2.status::text = 'active' then 0 else 1 end,
            am2.updated_at desc
          limit 1
        ),
        'affiliate'
      ) as partner_type
    from public.commissions c
    join approved_payments ap on ap.id = c.payment_id
    join public.orders o on o.id = ap.order_id
    left join public.affiliate_attributions aa on aa.order_id = o.id
    left join public.affiliate_memberships am on am.id = aa.affiliate_membership_id
    where c.status::text not in ('cancelled','reversed')
  ),
  commission_totals as (
    select
      coalesce(sum(cr.amount_cents) filter (
        where cr.commission_type = 'affiliate'
          and cr.partner_type = 'affiliate'
      ), 0)::bigint as affiliate_cents,
      coalesce(sum(cr.amount_cents) filter (
        where cr.commission_type = 'affiliate'
          and cr.partner_type = 'accredited'
      ), 0)::bigint as accredited_cents,
      coalesce(sum(cr.amount_cents) filter (
        where cr.commission_type = 'coproducer'
      ), 0)::bigint as coproducer_cents
    from commission_rows cr
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
$function$


CREATE OR REPLACE FUNCTION public.get_sales_cash_control_range_totals(target_user_id uuid, target_start_at timestamp with time zone, target_end_at timestamp with time zone)
 RETURNS TABLE(sales_count bigint, volume_cents bigint, product_revenue_cents bigint, ticket_average_cents bigint, available_cents bigint, pending_cents bigint, withdrawals_cents bigint, prosperity_fee_cents bigint, provider_fee_cents bigint, affiliate_commission_cents bigint, accredited_commission_cents bigint, coproducer_commission_cents bigint, total_commission_cents bigint)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  is_platform_admin boolean := false;
begin
  if target_user_id is null then
    raise exception 'Usuario obrigatorio.';
  end if;

  if target_start_at is null or target_end_at is null or target_end_at <= target_start_at then
    raise exception 'Intervalo invalido.';
  end if;

  if target_end_at - target_start_at > interval '2 years' then
    raise exception 'Intervalo acima do limite permitido.';
  end if;

  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = target_user_id
      and ur.role::text = 'admin'
  ) into is_platform_admin;

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
    join public.orders o on o.id = p.order_id
    where p.status::text = 'approved'
      and p.paid_at is not null
      and p.paid_at >= target_start_at
      and p.paid_at < target_end_at
      and (is_platform_admin or o.producer_id = target_user_id)
      and coalesce(p.raw_provider_data -> 'prosperity_hidden_test', 'false'::jsonb) <> 'true'::jsonb
    order by p.order_id, p.paid_at desc, p.created_at desc
  ),
  selected_orders as (
    select
      o.id,
      o.product_id,
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
        else
          coalesce(fs.producer_amount_cents, 0)
          - coalesce(so.provider_fee_amount_cents, 0)
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
    where is_platform_admin or ubs.user_id = target_user_id
  ),
  paid_withdrawals as (
    select coalesce(sum(w.amount_cents), 0)::bigint as total_cents
    from public.withdrawals w
    where w.status::text = 'paid'
      and w.paid_at is not null
      and w.paid_at >= target_start_at
      and w.paid_at < target_end_at
      and (is_platform_admin or w.user_id = target_user_id)
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
  commission_rows as (
    select
      c.amount_cents,
      c.commission_type::text as commission_type,
      coalesce(
        am.partner_type::text,
        (
          select am2.partner_type::text
          from public.affiliate_memberships am2
          join public.affiliate_programs ap2 on ap2.id = am2.program_id
          where am2.user_id = c.beneficiary_user_id
            and ap2.product_id = o.product_id
          order by
            case when am2.status::text = 'active' then 0 else 1 end,
            am2.updated_at desc
          limit 1
        ),
        'affiliate'
      ) as partner_type
    from public.commissions c
    join approved_payments ap on ap.id = c.payment_id
    join public.orders o on o.id = ap.order_id
    left join public.affiliate_attributions aa on aa.order_id = o.id
    left join public.affiliate_memberships am on am.id = aa.affiliate_membership_id
    where c.status::text not in ('cancelled','reversed')
  ),
  commission_totals as (
    select
      coalesce(sum(cr.amount_cents) filter (
        where cr.commission_type = 'affiliate'
          and cr.partner_type = 'affiliate'
      ), 0)::bigint as affiliate_cents,
      coalesce(sum(cr.amount_cents) filter (
        where cr.commission_type = 'affiliate'
          and cr.partner_type = 'accredited'
      ), 0)::bigint as accredited_cents,
      coalesce(sum(cr.amount_cents) filter (
        where cr.commission_type = 'coproducer'
      ), 0)::bigint as coproducer_cents
    from commission_rows cr
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
$function$


revoke all on function public.get_sales_cash_control_range_totals(uuid, timestamptz, timestamptz) from public;
revoke all on function public.get_sales_cash_control_range_totals(uuid, timestamptz, timestamptz) from anon;
revoke all on function public.get_sales_cash_control_range_totals(uuid, timestamptz, timestamptz) from authenticated;
grant execute on function public.get_sales_cash_control_range_totals(uuid, timestamptz, timestamptz) to service_role;
