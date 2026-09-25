begin;

alter table public.affiliate_memberships
  add column if not exists partner_type text not null default 'affiliate';

alter table public.affiliate_memberships
  drop constraint if exists affiliate_memberships_partner_type_check;

alter table public.affiliate_memberships
  add constraint affiliate_memberships_partner_type_check
  check (partner_type in ('affiliate','accredited'));

create index if not exists affiliate_memberships_user_partner_type_idx
  on public.affiliate_memberships(user_id, partner_type, status);

comment on column public.affiliate_memberships.partner_type is
  'Classificação comercial do parceiro. affiliate usa o fluxo padrão; accredited é o credenciado e reutiliza a mesma atribuição/comissão.';

commit;
