begin;

-- The legacy helper belongs to the platform bootstrap, but must never be exposed as an RPC.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

create policy payment_providers_select_active on public.payment_providers
  for select to authenticated using (active);
create policy customers_backend_only on public.customers
  for select to authenticated using (false);
create policy webhook_events_backend_only on public.webhook_events
  for select to authenticated using (false);

drop policy invitations_select_related on public.coproducer_invitations;
create policy invitations_select_related on public.coproducer_invitations for select to authenticated using (
  public.owns_product(product_id)
  or invited_user_id = (select auth.uid())
  or lower(invited_email) = lower(coalesce((select auth.jwt()) ->> 'email', ''))
);

alter table public.offers add constraint offers_id_product_uq unique (id, product_id);
alter table public.coproducer_invitations
  add constraint coproducer_invitations_offer_product_fk
  foreign key (offer_id, product_id) references public.offers(id, product_id) on delete cascade;
alter table public.product_participants
  add constraint product_participants_offer_product_fk
  foreign key (offer_id, product_id) references public.offers(id, product_id) on delete cascade;
alter table public.orders
  add constraint orders_offer_product_fk
  foreign key (offer_id, product_id) references public.offers(id, product_id);

alter table private.payment_provider_credentials rename column access_token to encrypted_access_token;
alter table private.payment_provider_credentials rename column refresh_token to encrypted_refresh_token;

create or replace function public.upsert_payment_provider_connection(
  target_owner_user_id uuid,
  target_connection_kind public.settlement_model,
  target_external_account_id text,
  target_public_key text,
  target_scopes text[],
  target_live_mode boolean,
  target_token_expires_at timestamptz,
  target_encrypted_access_token text,
  target_encrypted_refresh_token text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  mercado_pago_provider_id uuid;
  connection_id_value uuid;
begin
  if target_connection_kind = 'connected_account' and target_owner_user_id is null then
    raise exception 'connected account requires an owner';
  end if;
  if target_connection_kind = 'prosperity_balance' and target_owner_user_id is not null then
    raise exception 'platform connection cannot have an owner';
  end if;

  select id into mercado_pago_provider_id from public.payment_providers where code = 'mercadopago' and active;
  if mercado_pago_provider_id is null then raise exception 'Mercado Pago provider is not active'; end if;

  update public.payment_provider_connections
  set status = 'revoked', revoked_at = now()
  where provider_id = mercado_pago_provider_id
    and connection_kind = target_connection_kind
    and status = 'active'
    and owner_user_id is not distinct from target_owner_user_id;

  insert into public.payment_provider_connections(
    owner_user_id, provider_id, connection_kind, external_account_id, public_key,
    scopes, live_mode, token_expires_at
  ) values (
    target_owner_user_id, mercado_pago_provider_id, target_connection_kind,
    target_external_account_id, target_public_key, coalesce(target_scopes, '{}'),
    target_live_mode, target_token_expires_at
  ) returning id into connection_id_value;

  insert into private.payment_provider_credentials(
    connection_id, encrypted_access_token, encrypted_refresh_token
  ) values (
    connection_id_value, target_encrypted_access_token, target_encrypted_refresh_token
  );

  return connection_id_value;
end;
$$;
revoke all on function public.upsert_payment_provider_connection(uuid, public.settlement_model, text, text, text[], boolean, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.upsert_payment_provider_connection(uuid, public.settlement_model, text, text, text[], boolean, timestamptz, text, text) to service_role;

create or replace function public.get_payment_provider_credential(target_connection_id uuid)
returns table(encrypted_access_token text, encrypted_refresh_token text)
language sql stable security definer set search_path = '' as $$
  select c.encrypted_access_token, c.encrypted_refresh_token
  from private.payment_provider_credentials c
  join public.payment_provider_connections pc on pc.id = c.connection_id
  where c.connection_id = target_connection_id and pc.status = 'active';
$$;
revoke all on function public.get_payment_provider_credential(uuid) from public, anon, authenticated;
grant execute on function public.get_payment_provider_credential(uuid) to service_role;

create or replace function public.transition_withdrawal(
  target_withdrawal_id uuid,
  target_status public.withdrawal_status,
  target_operator_id uuid,
  target_receipt_reference text default null,
  target_note text default null
)
returns public.withdrawals
language plpgsql security definer set search_path = '' as $$
declare
  withdrawal_row public.withdrawals;
  account_id_value uuid;
begin
  select * into withdrawal_row from public.withdrawals where id = target_withdrawal_id for update;
  if not found then raise exception 'withdrawal not found'; end if;

  update public.withdrawals set
    status = target_status,
    operator_id = target_operator_id,
    receipt_reference = coalesce(target_receipt_reference, receipt_reference),
    note = coalesce(target_note, note),
    processed_at = case when target_status = 'processing' then now() else processed_at end,
    paid_at = case when target_status = 'paid' then now() else paid_at end
  where id = target_withdrawal_id
  returning * into withdrawal_row;

  if target_status in ('rejected', 'cancelled', 'failed') then
    select id into account_id_value from public.ledger_accounts
    where user_id = withdrawal_row.user_id and currency = withdrawal_row.currency;
    insert into public.ledger_entries(
      account_id, settlement_model, entry_type, amount_cents, currency,
      source_type, source_id, reference, metadata
    ) values (
      account_id_value, 'prosperity_balance', 'adjustment', withdrawal_row.amount_cents,
      withdrawal_row.currency, 'withdrawal_release', withdrawal_row.id,
      'withdrawal_release:' || withdrawal_row.id,
      jsonb_build_object('reason', target_status::text)
    ) on conflict do nothing;
  end if;
  return withdrawal_row;
end;
$$;
revoke all on function public.transition_withdrawal(uuid, public.withdrawal_status, uuid, text, text) from public, anon, authenticated;
grant execute on function public.transition_withdrawal(uuid, public.withdrawal_status, uuid, text, text) to service_role;

create index affiliate_attributions_link_idx on public.affiliate_attributions(affiliate_link_id);
create index affiliate_links_membership_idx on public.affiliate_links(membership_id);
create index affiliate_links_offer_idx on public.affiliate_links(offer_id);
create index affiliate_memberships_approved_by_idx on public.affiliate_memberships(approved_by);
create index affiliate_memberships_invited_by_idx on public.affiliate_memberships(invited_by);
create index audit_events_actor_idx on public.audit_events(actor_user_id);
create index commissions_payment_idx on public.commissions(payment_id);
create index coproducer_invitations_invited_by_idx on public.coproducer_invitations(invited_by);
create index coproducer_invitations_user_idx on public.coproducer_invitations(invited_user_id);
create index coproducer_invitations_offer_idx on public.coproducer_invitations(offer_id);
create index coproducer_invitations_product_idx on public.coproducer_invitations(product_id);
create index financial_allocations_beneficiary_idx on public.financial_allocations(beneficiary_user_id);
create index identity_documents_verification_idx on public.identity_documents(verification_id);
create index identity_verifications_reviewer_idx on public.identity_verifications(reviewer_id);
create index ledger_entries_order_idx on public.ledger_entries(order_id);
create index orders_customer_idx on public.orders(customer_id);
create index orders_product_idx on public.orders(product_id);
create index payment_provider_checkouts_connection_idx on public.payment_provider_checkouts(connection_id);
create index payment_provider_connections_owner_idx on public.payment_provider_connections(owner_user_id);
create index payments_connection_idx on public.payments(connection_id);
create index product_participants_invitation_idx on public.product_participants(invitation_id);
create index product_participants_offer_idx on public.product_participants(offer_id);
create index subscriptions_customer_idx on public.subscriptions(customer_id);
create index subscriptions_offer_idx on public.subscriptions(offer_id);
create index subscriptions_order_idx on public.subscriptions(order_id);
create index user_roles_granted_by_idx on public.user_roles(granted_by);
create index withdrawals_operator_idx on public.withdrawals(operator_id);
create index withdrawals_payout_account_idx on public.withdrawals(payout_account_id);

commit;
