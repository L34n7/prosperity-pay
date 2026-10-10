create or replace function public.register_external_subscription_sale(
  target_product_id uuid,
  customer_email text,
  paid_at_override timestamptz default null,
  payment_method text default 'pix',
  partner_ref text default null,
  recorded_by text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_email text := lower(trim(customer_email));
  v_method text := lower(trim(coalesce(payment_method, 'pix')));
  v_product public.products;
  v_customer public.customers;
  v_subscription public.subscriptions;
  v_offer public.offers;
  v_provider_id uuid;
  v_connection_id uuid;
  v_paid_at timestamptz;
  v_idempotency text;
  v_existing_order public.orders;
  v_existing_payment public.payments;
  v_order_id uuid := gen_random_uuid();
  v_payment_id uuid := gen_random_uuid();
  v_snapshot_id uuid := gen_random_uuid();
  v_order_number bigint;
  v_partner_membership public.affiliate_memberships;
  v_partner_link public.affiliate_links;
  v_partner_user_id uuid;
  v_partner_type text;
  v_partner_code text;
  v_program public.affiliate_programs;
  v_base_bps integer := 0;
  v_offer_override_bps integer;
  v_addon_override_bps integer;
  v_commission_base_cents bigint := 0;
  v_partner_commission_cents bigint := 0;
  v_producer_amount_cents bigint;
  v_gross_amount_cents bigint;
  v_line_total bigint;
  v_line_commissionable bigint;
  v_line_bps integer;
  v_has_partner boolean := false;
  v_item public.subscription_items;
begin
  if v_email = '' or position('@' in v_email) < 2 then
    raise exception 'E-mail do cliente inválido.';
  end if;

  if v_method not in ('pix', 'card') then
    raise exception 'Forma de pagamento externa inválida.';
  end if;

  select *
    into v_product
  from public.products
  where id = target_product_id;

  if not found then
    raise exception 'Produto não encontrado.';
  end if;

  select *
    into v_customer
  from public.customers
  where lower(email) = v_email
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'Cliente não encontrado na Prosperity Pay.';
  end if;

  select *
    into v_subscription
  from public.subscriptions
  where customer_id = v_customer.id
    and product_id = target_product_id
    and status = 'active'
  order by created_at desc
  limit 1;

  if not found then
    raise exception 'Assinatura ativa não encontrada para este cliente.';
  end if;

  select *
    into v_offer
  from public.offers
  where id = v_subscription.offer_id
    and product_id = target_product_id;

  if not found then
    raise exception 'Oferta da assinatura não encontrada.';
  end if;

  v_paid_at := coalesce(paid_at_override, v_subscription.current_period_start, now());
  v_gross_amount_cents := coalesce(v_subscription.current_amount_cents, v_subscription.amount_cents, 0);

  if v_gross_amount_cents <= 0 then
    raise exception 'Valor atual da assinatura é inválido.';
  end if;

  v_idempotency :=
    'external-sale:' || v_subscription.id::text || ':' ||
    to_char(v_paid_at at time zone 'America/Sao_Paulo', 'YYYYMMDD') || ':' ||
    v_gross_amount_cents::text;

  select *
    into v_existing_order
  from public.orders
  where idempotency_key = v_idempotency
  limit 1;

  if found then
    select *
      into v_existing_payment
    from public.payments
    where order_id = v_existing_order.id
    order by created_at desc
    limit 1;

    return jsonb_build_object(
      'ok', true,
      'reused', true,
      'order_id', v_existing_order.id,
      'order_number', v_existing_order.order_number,
      'payment_id', v_existing_payment.id,
      'subscription_id', v_subscription.id,
      'customer_email', v_email,
      'gross_amount_cents', v_existing_order.gross_amount_cents
    );
  end if;

  select pp.id, pc.id
    into v_provider_id, v_connection_id
  from public.payment_providers pp
  join public.payment_provider_connections pc on pc.provider_id = pp.id
  where pp.code = 'manual'
    and pc.connection_kind = 'prosperity_balance'
  order by pc.created_at desc
  limit 1;

  if v_provider_id is null or v_connection_id is null then
    raise exception 'Provedor manual da Prosperity Pay não está configurado.';
  end if;

  if nullif(trim(coalesce(partner_ref, '')), '') is not null then
    select am.*
      into v_partner_membership
    from public.affiliate_memberships am
    join public.affiliate_programs ap on ap.id = am.program_id
    where ap.product_id = target_product_id
      and ap.active = true
      and am.status = 'active'
      and am.code = trim(partner_ref)
    limit 1;

    if not found then
      raise exception 'Parceiro informado não está ativo neste produto.';
    end if;
  elsif v_subscription.affiliate_membership_id is not null then
    select am.*
      into v_partner_membership
    from public.affiliate_memberships am
    join public.affiliate_programs ap on ap.id = am.program_id
    where am.id = v_subscription.affiliate_membership_id
      and ap.product_id = target_product_id
      and ap.active = true
      and am.status = 'active'
    limit 1;
  end if;

  if v_partner_membership.id is not null then
    v_has_partner := true;
    v_partner_user_id := v_partner_membership.user_id;
    v_partner_type := coalesce(v_partner_membership.partner_type, 'affiliate');
    v_partner_code := v_partner_membership.code;

    select ap.*
      into v_program
    from public.affiliate_programs ap
    where ap.id = v_partner_membership.program_id;

    select al.*
      into v_partner_link
    from public.affiliate_links al
    where al.membership_id = v_partner_membership.id
      and al.active = true
      and (al.offer_id = v_offer.id or al.offer_id is null)
    order by case when al.offer_id = v_offer.id then 0 else 1 end, al.created_at
    limit 1;

    if v_partner_link.id is null then
      raise exception 'Link ativo do parceiro não encontrado.';
    end if;

    select aoco.commission_bps
      into v_offer_override_bps
    from public.affiliate_offer_commission_overrides aoco
    where aoco.membership_id = v_partner_membership.id
      and aoco.offer_id = v_offer.id
    limit 1;

    v_base_bps := coalesce(
      v_offer_override_bps,
      v_partner_membership.affiliate_commission_bps_override,
      v_offer.affiliate_commission_bps,
      0
    );
  end if;

  for v_item in
    select *
    from public.subscription_items
    where subscription_id = v_subscription.id
      and status = 'active'
    order by created_at
  loop
    v_line_total := v_item.unit_amount_cents * v_item.quantity;
    v_line_commissionable := 0;
    v_line_bps := 0;

    if v_has_partner and coalesce(v_offer.affiliate_enabled, false) then
      if v_item.item_type = 'base' then
        v_line_commissionable := v_line_total;
        v_line_bps := v_base_bps;
      elsif v_item.item_type = 'addon' and coalesce(v_program.commission_addons, false) then
        select aaco.commission_bps
          into v_addon_override_bps
        from public.affiliate_addon_commission_overrides aaco
        where aaco.membership_id = v_partner_membership.id
          and aaco.addon_id = v_item.addon_id
        limit 1;

        v_line_commissionable := v_line_total;
        v_line_bps := coalesce(v_addon_override_bps, v_base_bps);
      end if;
    end if;

    v_commission_base_cents := v_commission_base_cents + v_line_commissionable;

    if v_line_commissionable > 0 and v_line_bps > 0 then
      v_partner_commission_cents :=
        v_partner_commission_cents +
        round(v_line_commissionable * v_line_bps / 10000.0)::bigint;
    end if;
  end loop;

  if v_has_partner
     and coalesce(v_offer.affiliate_enabled, false)
     and v_offer.affiliate_commission_type = 'fixed'
     and coalesce(v_offer.affiliate_commission_fixed_cents, 0) > 0 then
    v_partner_commission_cents := v_offer.affiliate_commission_fixed_cents;
  end if;

  if v_partner_commission_cents > v_gross_amount_cents then
    raise exception 'Comissão do parceiro excede o valor da venda.';
  end if;

  v_producer_amount_cents := v_gross_amount_cents - v_partner_commission_cents;

  insert into public.orders (
    id,
    product_id,
    offer_id,
    producer_id,
    customer_id,
    settlement_model,
    status,
    gross_amount_cents,
    currency,
    idempotency_key,
    paid_at,
    created_at,
    subscription_id,
    billing_reason
  )
  values (
    v_order_id,
    target_product_id,
    v_offer.id,
    v_product.producer_id,
    v_customer.id,
    'prosperity_balance',
    'paid',
    v_gross_amount_cents,
    v_offer.currency,
    v_idempotency,
    v_paid_at,
    v_paid_at,
    v_subscription.id,
    'subscription_initial'
  )
  returning order_number into v_order_number;

  update public.subscriptions
  set
    order_id = coalesce(order_id, v_order_id),
    affiliate_membership_id = case
      when v_has_partner then v_partner_membership.id
      else affiliate_membership_id
    end,
    affiliate_link_id = case
      when v_has_partner then v_partner_link.id
      else affiliate_link_id
    end,
    updated_at = now()
  where id = v_subscription.id;

  insert into public.order_items (
    order_id,
    subscription_id,
    subscription_item_id,
    line_type,
    item_code,
    description,
    unit_amount_cents,
    quantity,
    total_amount_cents,
    commissionable_amount_cents,
    metadata,
    created_at
  )
  select
    v_order_id,
    v_subscription.id,
    si.id,
    si.item_type,
    si.code,
    si.description,
    si.unit_amount_cents,
    si.quantity,
    si.unit_amount_cents * si.quantity,
    case
      when v_has_partner
        and coalesce(v_offer.affiliate_enabled, false)
        and si.item_type = 'base'
        then si.unit_amount_cents * si.quantity
      when v_has_partner
        and coalesce(v_offer.affiliate_enabled, false)
        and si.item_type = 'addon'
        and coalesce(v_program.commission_addons, false)
        then si.unit_amount_cents * si.quantity
      else 0
    end,
    jsonb_build_object(
      'source', 'manual_external_sale',
      'paid_outside_platform', true,
      'partner_type', v_partner_type
    ),
    v_paid_at
  from public.subscription_items si
  where si.subscription_id = v_subscription.id
    and si.status = 'active';

  insert into public.payments (
    id,
    order_id,
    provider_id,
    connection_id,
    external_payment_id,
    external_reference,
    idempotency_key,
    status,
    gross_amount_cents,
    provider_fee_amount_cents,
    currency,
    status_detail,
    paid_at,
    raw_provider_data,
    created_at
  )
  values (
    v_payment_id,
    v_order_id,
    v_provider_id,
    v_connection_id,
    'manual-' || v_order_id::text,
    'manual:' || v_order_id::text,
    'payment:' || v_idempotency,
    'approved',
    v_gross_amount_cents,
    0,
    v_offer.currency,
    'manual_external_sale',
    v_paid_at,
    jsonb_build_object(
      'source', 'manual_external_sale',
      'plan_label',
        case
          when exists (
            select 1
            from public.subscription_items si
            where si.subscription_id = v_subscription.id
              and si.status = 'active'
              and si.item_type = 'addon'
          )
          then v_offer.name || ' + adicionais'
          else v_offer.name
        end,
      'description', v_offer.name || ' - venda externa',
      'recorded_by', coalesce(recorded_by, 'prosperity_pay'),
      'payment_method', jsonb_build_object(
        'id', case when v_method = 'pix' then 'pix' else 'manual_card' end,
        'type', case when v_method = 'pix' then 'bank_transfer' else 'credit_card' end
      ),
      'payment_type_id', case when v_method = 'pix' then 'bank_transfer' else 'credit_card' end,
      'manual_sale_date', to_char(v_paid_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
      'manual_sale_time_unknown', paid_at_override is null,
      'gateway_fee_cents', 0,
      'paid_outside_platform', true,
      'affiliateRefCode', v_partner_code,
      'affiliateMembershipId', case when v_has_partner then v_partner_membership.id else null end,
      'affiliateLinkId', case when v_has_partner then v_partner_link.id else null end,
      'partnerType', v_partner_type
    ),
    v_paid_at
  );

  insert into public.payment_transactions (
    payment_id,
    provider_event_id,
    transaction_type,
    amount_cents,
    status,
    raw_payload,
    occurred_at,
    created_at
  )
  values (
    v_payment_id,
    'manual-external:' || v_payment_id::text,
    'manual_external_payment',
    v_gross_amount_cents,
    'approved',
    jsonb_build_object(
      'source', 'manual_external_sale',
      'payment_method', v_method,
      'recorded_by', coalesce(recorded_by, 'prosperity_pay')
    ),
    v_paid_at,
    now()
  );

  if v_has_partner then
    insert into public.affiliate_attributions (
      affiliate_link_id,
      affiliate_membership_id,
      order_id,
      ref_code,
      attributed_at,
      expires_at,
      metadata
    )
    values (
      v_partner_link.id,
      v_partner_membership.id,
      v_order_id,
      v_partner_code,
      v_paid_at,
      v_paid_at + make_interval(days => coalesce(v_program.cookie_days, 7)),
      jsonb_build_object(
        'source', 'manual_external_sale',
        'partner_type', v_partner_type,
        'paid_outside_platform', true
      )
    );
  end if;

  insert into public.financial_snapshots (
    id,
    order_id,
    settlement_model,
    currency,
    gross_amount_cents,
    gateway_fee_amount_cents,
    prosperity_fee_amount_cents,
    affiliate_amount_cents,
    coproducer_amount_cents,
    producer_amount_cents,
    prosperity_split_amount_cents,
    calculation_version,
    rules,
    created_at
  )
  values (
    v_snapshot_id,
    v_order_id,
    'prosperity_balance',
    v_offer.currency,
    v_gross_amount_cents,
    0,
    0,
    v_partner_commission_cents,
    0,
    v_producer_amount_cents,
    0,
    1,
    jsonb_build_object(
      'source', 'manual_external_sale',
      'manualEntry', true,
      'paidOutsidePlatform', true,
      'gatewayFeeCents', 0,
      'prosperityFeeCents', 0,
      'affiliateCommissionBps', v_base_bps,
      'commissionBaseCents', v_commission_base_cents,
      'commissionAddons', coalesce(v_program.commission_addons, false),
      'partnerType', v_partner_type
    ),
    v_paid_at
  );

  insert into public.financial_allocations (
    snapshot_id,
    allocation_type,
    destination,
    beneficiary_user_id,
    amount_cents,
    currency,
    rule_snapshot,
    created_at
  )
  values (
    v_snapshot_id,
    'producer',
    'internal_balance',
    v_product.producer_id,
    v_producer_amount_cents,
    v_offer.currency,
    jsonb_build_object(
      'source', 'manual_external_sale',
      'role', 'primary_producer',
      'grossAmountCents', v_gross_amount_cents,
      'partnerCommissionCents', v_partner_commission_cents
    ),
    v_paid_at
  );

  if v_has_partner and v_partner_commission_cents > 0 then
    insert into public.financial_allocations (
      snapshot_id,
      allocation_type,
      destination,
      beneficiary_user_id,
      amount_cents,
      currency,
      rule_snapshot,
      created_at
    )
    values (
      v_snapshot_id,
      'affiliate',
      'internal_balance',
      v_partner_user_id,
      v_partner_commission_cents,
      v_offer.currency,
      jsonb_build_object(
        'source', 'manual_external_sale',
        'affiliate_code', v_partner_code,
        'commission_bps', v_base_bps,
        'commission_base_cents', v_commission_base_cents,
        'commission_addons', coalesce(v_program.commission_addons, false),
        'partner_type', v_partner_type
      ),
      v_paid_at
    );
  end if;

  perform public.post_payment_financials(v_payment_id);

  return jsonb_build_object(
    'ok', true,
    'reused', false,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'payment_id', v_payment_id,
    'subscription_id', v_subscription.id,
    'customer_email', v_email,
    'gross_amount_cents', v_gross_amount_cents,
    'commissionable_amount_cents', v_commission_base_cents,
    'partner_commission_cents', v_partner_commission_cents,
    'producer_amount_cents', v_producer_amount_cents,
    'partner_ref', v_partner_code,
    'partner_type', v_partner_type,
    'paid_at', v_paid_at
  );
end;
$function$;

revoke all on function public.register_external_subscription_sale(uuid,text,timestamptz,text,text,text) from public, anon, authenticated;
grant execute on function public.register_external_subscription_sale(uuid,text,timestamptz,text,text,text) to service_role;
