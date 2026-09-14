-- Enforce the commercial limit on both existing and new offers.
update public.offers
set affiliate_hold_days = 7,
    max_installments = greatest(1, least(12::bigint, price_cents / 5000))::integer
where affiliate_hold_days <> 7
   or max_installments <> greatest(1, least(12::bigint, price_cents / 5000))::integer;

alter table public.offers
  add constraint offers_affiliate_hold_fixed_check check (affiliate_hold_days = 7),
  add constraint offers_installments_by_price_check
    check (max_installments = greatest(1, least(12::bigint, price_cents / 5000))::integer);

-- RLS protects rows; column grants prevent direct Data API writes to platform fees.
revoke insert, update on public.products, public.offers from authenticated;
grant insert (producer_id, name, slug, description, settlement_model) on public.products to authenticated;
grant update (name, description, status, image_path) on public.products to authenticated;
grant insert (product_id, name, checkout_slug, price_cents, billing_type,
  billing_interval, billing_interval_count, max_installments) on public.offers to authenticated;
grant update (name, price_cents, status, affiliate_commission_bps,
  max_installments) on public.offers to authenticated;

-- Start the seven-day period at the provider's approval timestamp, even if
-- processing of its notification happens later. Reversal entries remain intact.
create or replace function public.post_payment_financials(target_payment_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  payment_row public.payments;
  allocation_row public.financial_allocations;
  snapshot_row public.financial_snapshots;
  account_id_value uuid;
  inserted_count integer := 0;
  available_time timestamptz;
  mapped_type public.ledger_entry_type;
begin
  select * into payment_row from public.payments where id = target_payment_id and status = 'approved' for update;
  if not found then raise exception 'approved payment not found'; end if;
  select fs.* into snapshot_row from public.financial_snapshots fs where fs.order_id = payment_row.order_id;

  for allocation_row in
    select * from public.financial_allocations where snapshot_id = snapshot_row.id and amount_cents > 0
  loop
    if allocation_row.destination in ('connected_account', 'gateway') then continue; end if;
    if allocation_row.beneficiary_user_id is not null then
      insert into public.ledger_accounts(account_type, user_id, currency)
      values ('user_balance', allocation_row.beneficiary_user_id, allocation_row.currency) on conflict do nothing;
      select id into account_id_value from public.ledger_accounts
      where user_id = allocation_row.beneficiary_user_id and currency = allocation_row.currency;
    elsif allocation_row.allocation_type = 'prosperity_fee' then
      insert into public.ledger_accounts(account_type, currency)
      values ('platform_revenue', allocation_row.currency) on conflict do nothing;
      select id into account_id_value from public.ledger_accounts
      where account_type = 'platform_revenue' and user_id is null and currency = allocation_row.currency;
    else
      continue;
    end if;

    mapped_type := case allocation_row.allocation_type
      when 'producer' then 'sale_credit'::public.ledger_entry_type
      when 'affiliate' then 'affiliate_commission'::public.ledger_entry_type
      when 'coproducer' then 'coproducer_commission'::public.ledger_entry_type
      when 'prosperity_fee' then 'prosperity_fee'::public.ledger_entry_type
      else 'adjustment'::public.ledger_entry_type end;
    available_time := case when allocation_row.allocation_type in ('affiliate', 'coproducer')
      then coalesce(payment_row.paid_at, now()) + interval '7 days' else now() end;

    insert into public.ledger_entries(
      account_id, order_id, payment_id, settlement_model, entry_type, amount_cents,
      currency, available_at, source_type, source_id, reference
    ) values (
      account_id_value, payment_row.order_id, payment_row.id, snapshot_row.settlement_model,
      mapped_type, allocation_row.amount_cents, allocation_row.currency, available_time,
      'allocation', allocation_row.id, 'payment:' || payment_row.id
    ) on conflict do nothing;
    if found then inserted_count := inserted_count + 1; end if;

    if allocation_row.allocation_type in ('affiliate', 'coproducer') then
      insert into public.commissions(
        allocation_id, payment_id, beneficiary_user_id, commission_type,
        amount_cents, currency, available_at
      ) values (
        allocation_row.id, payment_row.id, allocation_row.beneficiary_user_id,
        allocation_row.allocation_type, allocation_row.amount_cents,
        allocation_row.currency, available_time
      ) on conflict (allocation_id) do nothing;
    end if;
  end loop;
  -- The gateway fee is only known after the provider confirms the payment.
  -- Keep the immutable checkout snapshot, and debit the actual fee once.
  if snapshot_row.settlement_model = 'prosperity_balance' and payment_row.provider_fee_amount_cents > 0 then
    insert into public.ledger_accounts(account_type, user_id, currency)
      select 'user_balance', ord.producer_id, payment_row.currency
      from public.orders ord where ord.id = payment_row.order_id
      on conflict do nothing;
    select la.id into account_id_value from public.ledger_accounts la
      join public.orders ord on ord.producer_id = la.user_id
      where ord.id = payment_row.order_id and la.currency = payment_row.currency;
    insert into public.ledger_entries(
      account_id, order_id, payment_id, settlement_model, entry_type, amount_cents,
      currency, source_type, source_id, reference, metadata
    ) values (
      account_id_value, payment_row.order_id, payment_row.id, snapshot_row.settlement_model,
      'gateway_fee', -payment_row.provider_fee_amount_cents, payment_row.currency,
      'payment_gateway_fee', payment_row.id, 'gateway_fee:' || payment_row.id,
      jsonb_build_object('observed_fee_cents', payment_row.provider_fee_amount_cents)
    ) on conflict do nothing;
  end if;
  return inserted_count;
end;
$$;
revoke all on function public.post_payment_financials(uuid) from public, anon, authenticated;
grant execute on function public.post_payment_financials(uuid) to service_role;
