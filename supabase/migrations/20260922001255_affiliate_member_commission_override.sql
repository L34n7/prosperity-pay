alter table public.affiliate_memberships
  add column if not exists affiliate_commission_bps_override integer;

alter table public.affiliate_memberships
  drop constraint if exists affiliate_memberships_affiliate_commission_bps_override_check;

alter table public.affiliate_memberships
  add constraint affiliate_memberships_affiliate_commission_bps_override_check
  check (
    affiliate_commission_bps_override is null
    or affiliate_commission_bps_override between 0 and 10000
  );

comment on column public.affiliate_memberships.affiliate_commission_bps_override is
  'Optional per-affiliate commission percentage in basis points. When set, it overrides the offer/default affiliate commission.';
