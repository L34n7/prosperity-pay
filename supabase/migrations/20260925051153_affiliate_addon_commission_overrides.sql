begin;

create table if not exists public.affiliate_addon_commission_overrides (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.affiliate_memberships(id) on delete cascade,
  addon_id uuid not null references public.product_addons(id) on delete cascade,
  commission_bps integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint affiliate_addon_commission_overrides_bps_check
    check (commission_bps between 0 and 10000),
  constraint affiliate_addon_commission_overrides_membership_addon_key
    unique (membership_id, addon_id)
);

create index if not exists affiliate_addon_commission_overrides_addon_idx
  on public.affiliate_addon_commission_overrides(addon_id);

alter table public.affiliate_addon_commission_overrides enable row level security;
alter table public.affiliate_addon_commission_overrides force row level security;

revoke all on table public.affiliate_addon_commission_overrides from public, anon, authenticated;
grant select, insert, update, delete on table public.affiliate_addon_commission_overrides to service_role;

comment on table public.affiliate_addon_commission_overrides is
  'Exceções de comissão por parceiro e adicional recorrente. Ausência de registro faz o adicional herdar a comissão efetiva da oferta/plano do cliente.';

commit;
