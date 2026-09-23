
begin;

create unique index if not exists subscription_checkout_sessions_order_uq
  on public.subscription_checkout_sessions(order_id)
  where order_id is not null;

create or replace function public.claim_subscription_checkout_session(
  target_session_id uuid,
  target_order_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_order_id uuid;
begin
  update public.subscription_checkout_sessions
  set order_id = target_order_id
  where id = target_session_id
    and order_id is null
    and consumed_at is null
    and expires_at > now()
  returning order_id into claimed_order_id;

  if claimed_order_id is not null then
    return claimed_order_id;
  end if;

  select order_id into claimed_order_id
  from public.subscription_checkout_sessions
  where id = target_session_id;

  return claimed_order_id;
end;
$$;

revoke all on function public.claim_subscription_checkout_session(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_subscription_checkout_session(uuid, uuid)
  to service_role;

commit;
