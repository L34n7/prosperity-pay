begin;

create table if not exists public.product_accredited_settings (
  product_id uuid primary key references public.products(id) on delete cascade,
  active boolean not null default true,
  allow_direct_invites boolean not null default true,
  allow_affiliate_evolution boolean not null default true,
  customer_portfolio_access boolean not null default true,
  customer_contact_access boolean not null default true,
  subscription_details_access boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.product_accredited_settings enable row level security;
alter table public.product_accredited_settings force row level security;

revoke all on table public.product_accredited_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.product_accredited_settings to service_role;

comment on table public.product_accredited_settings is
  'Configurações gerais da categoria Credenciado por produto. Mantida separada das regras globais de afiliação.';

commit;
