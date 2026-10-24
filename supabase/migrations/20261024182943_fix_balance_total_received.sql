create or replace view public.user_balance_summary
with (security_invoker = true) as
select
  la.user_id,
  la.currency,
  coalesce(
    sum(le.amount_cents) filter (
      where le.status = 'posted'::public.ledger_entry_status
        and le.available_at > now()
    ),
    0
  )::bigint as pending_cents,
  coalesce(
    sum(le.amount_cents) filter (
      where le.status = 'posted'::public.ledger_entry_status
        and le.available_at <= now()
    ),
    0
  )::bigint as available_cents,
  coalesce(
    (
      select sum(w.amount_cents)
      from public.withdrawals w
      where w.user_id = la.user_id
        and w.status in (
          'requested'::public.withdrawal_status,
          'processing'::public.withdrawal_status
        )
    ),
    0
  )::bigint as withdrawing_cents,
  coalesce(
    sum(le.amount_cents) filter (
      where le.status = 'posted'::public.ledger_entry_status
        and le.entry_type <> 'withdrawal'::public.ledger_entry_type
    ),
    0
  )::bigint as total_received_cents
from public.ledger_accounts la
left join public.ledger_entries le on le.account_id = la.id
where la.account_type = 'user_balance'::public.ledger_account_type
group by la.user_id, la.currency;

grant select on public.user_balance_summary to authenticated;
