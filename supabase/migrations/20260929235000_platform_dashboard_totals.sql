begin;

create or replace function public.get_platform_dashboard_totals()
returns table (
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
as $$
begin
  if not public.is_finance_admin() then
    raise exception 'Acesso administrativo necessario.';
  end if;

  return query
  with approved_payments as (
    select
      p.id,
      p.order_id,
      p.gross_amount_cents,
      p.provider_fee_amount_cents,
      p.paid_at,
      p.created_at
    from public.payments p
    where p.status::text = 'approved'
  ),
  approved_orders as (
    select distinct on (o.id)
      o.id,
      o.producer_id,
      o.settlement_model,
      ap.provider_fee_amount_cents
    from public.orders o
    join approved_payments ap on ap.order_id = o.id
    order by o.id, ap.paid_at desc nulls last, ap.created_at desc
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
          - case
              when ao.settlement_model::text = 'prosperity_balance'
                then coalesce(ao.provider_fee_amount_cents, 0)
              else 0
            end
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
    join public.payments p on p.id = c.payment_id
    join public.orders o on o.id = p.order_id
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
$$;

revoke all on function public.get_platform_dashboard_totals() from public, anon;
grant execute on function public.get_platform_dashboard_totals() to authenticated;

commit;
