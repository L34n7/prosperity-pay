begin;

grant usage on schema private to authenticated;

create or replace function private.is_finance_admin_core()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles
    where user_id = (select auth.uid()) and role in ('admin', 'finance_operator')
  );
$$;
revoke all on function private.is_finance_admin_core() from public, anon;
grant execute on function private.is_finance_admin_core() to authenticated;

create or replace function public.is_finance_admin()
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.is_finance_admin_core();
$$;

create or replace function private.owns_product_core(target_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.products
    where id = target_product_id and producer_id = (select auth.uid())
  );
$$;
revoke all on function private.owns_product_core(uuid) from public, anon;
grant execute on function private.owns_product_core(uuid) to authenticated;

create or replace function public.owns_product(target_product_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.owns_product_core(target_product_id);
$$;

create or replace function private.participates_in_product_core(target_product_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.product_participants
    where product_id = target_product_id and user_id = (select auth.uid()) and active
  ) or private.owns_product_core(target_product_id);
$$;
revoke all on function private.participates_in_product_core(uuid) from public, anon;
grant execute on function private.participates_in_product_core(uuid) to authenticated;

create or replace function public.participates_in_product(target_product_id uuid)
returns boolean language sql stable security invoker set search_path = '' as $$
  select private.participates_in_product_core(target_product_id);
$$;

create or replace function private.request_withdrawal_core(requested_amount_cents bigint, requested_payout_account_id uuid)
returns public.withdrawals
language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  payout public.payout_accounts;
  available_cents bigint;
  created_withdrawal public.withdrawals;
  user_account_id uuid;
begin
  if current_user_id is null then raise exception 'authentication required'; end if;
  if requested_amount_cents <= 0 then raise exception 'withdrawal amount must be positive'; end if;
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 0));
  if not exists (
    select 1 from public.identity_verifications
    where user_id = current_user_id and status = 'approved'
  ) then raise exception 'approved identity verification required'; end if;
  select * into payout from public.payout_accounts
  where id = requested_payout_account_id and user_id = current_user_id and status = 'verified';
  if not found then raise exception 'verified payout account not found'; end if;
  insert into public.ledger_accounts(account_type, user_id, currency)
  values ('user_balance', current_user_id, 'BRL') on conflict do nothing;
  select id into user_account_id from public.ledger_accounts
  where user_id = current_user_id and currency = 'BRL';
  select coalesce(sum(amount_cents), 0) into available_cents
  from public.ledger_entries
  where account_id = user_account_id and status = 'posted' and available_at <= now();
  if available_cents < requested_amount_cents then raise exception 'insufficient available balance'; end if;
  insert into public.withdrawals(
    user_id, payout_account_id, amount_cents, currency, payout_key_type,
    payout_key_last4, payout_holder_name, payout_holder_tax_id_last4
  ) values (
    current_user_id, payout.id, requested_amount_cents, 'BRL', payout.key_type,
    payout.key_last4, payout.holder_name, payout.holder_tax_id_last4
  ) returning * into created_withdrawal;
  insert into public.ledger_entries(
    account_id, settlement_model, entry_type, amount_cents, currency,
    source_type, source_id, reference
  ) values (
    user_account_id, 'prosperity_balance', 'withdrawal', -requested_amount_cents, 'BRL',
    'withdrawal', created_withdrawal.id, 'withdrawal:' || created_withdrawal.id
  );
  return created_withdrawal;
end;
$$;
revoke all on function private.request_withdrawal_core(bigint, uuid) from public, anon;
grant execute on function private.request_withdrawal_core(bigint, uuid) to authenticated;

create or replace function public.request_withdrawal(requested_amount_cents bigint, requested_payout_account_id uuid)
returns public.withdrawals language sql security invoker set search_path = '' as $$
  select private.request_withdrawal_core(requested_amount_cents, requested_payout_account_id);
$$;

create index coproducer_invitations_offer_product_idx on public.coproducer_invitations(offer_id, product_id);
create index product_participants_offer_product_idx on public.product_participants(offer_id, product_id);
create index orders_offer_product_idx on public.orders(offer_id, product_id);

commit;
