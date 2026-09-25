begin;

create table if not exists public.affiliate_offer_commission_overrides (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.affiliate_memberships(id) on delete cascade,
  offer_id uuid not null references public.offers(id) on delete cascade,
  commission_bps integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_offer_commission_overrides_bps_check
    check (commission_bps between 0 and 10000),
  constraint affiliate_offer_commission_overrides_membership_offer_key
    unique (membership_id, offer_id)
);

create index if not exists affiliate_offer_commission_overrides_offer_idx
  on public.affiliate_offer_commission_overrides(offer_id);

alter table public.affiliate_offer_commission_overrides enable row level security;
alter table public.affiliate_offer_commission_overrides force row level security;

revoke all on table public.affiliate_offer_commission_overrides from public, anon, authenticated;
grant select, insert, update, delete on table public.affiliate_offer_commission_overrides to service_role;

insert into public.affiliate_offer_commission_overrides (
  membership_id,
  offer_id,
  commission_bps
)
select
  am.id,
  o.id,
  am.affiliate_commission_bps_override
from public.affiliate_memberships am
join public.affiliate_programs ap on ap.id = am.program_id
join public.offers o on o.product_id = ap.product_id
where am.affiliate_commission_bps_override is not null
  and o.affiliate_enabled = true
on conflict (membership_id, offer_id)
do nothing;

update public.affiliate_memberships
set affiliate_commission_bps_override = null,
    updated_at = now()
where affiliate_commission_bps_override is not null;

comment on table public.affiliate_offer_commission_overrides is
  'Exceções de comissão por parceiro e por oferta. Ausência de registro significa usar a comissão padrão configurada na oferta.';

commit;
