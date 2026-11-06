-- Ajustes de fatura (creditos/estornos e encargos) sem alterar saldo bancario.
create table public.finance_card_adjustments (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null,
  invoice_month date not null check (extract(day from invoice_month)=1),
  box_id uuid not null,
  kind text not null check(kind in ('credit','debit')),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  amount_cents bigint not null check (amount_cents between 1 and 999999999999),
  notes text check (notes is null or char_length(notes)<=1000),
  created_at timestamptz not null default now(),
  foreign key (card_id,owner_user_id) references public.finance_cards(id,owner_user_id),
  foreign key (box_id,owner_user_id) references public.finance_boxes(id,owner_user_id)
);
create index finance_card_adjustments_month_idx on public.finance_card_adjustments
 (owner_user_id,card_id,invoice_month,box_id);

create function private.finance_card_adjustment_guard()
returns trigger language plpgsql set search_path='' as $$
declare v_owner uuid; v_month date; v_status text; v_total bigint; v_paid bigint;
  v_card uuid; v_box uuid; v_kind text; v_amount bigint;
begin
  if tg_op='UPDATE' then raise exception 'Ajuste imutavel. Apague e registre novamente.'; end if;
  if tg_op='DELETE' then
    v_owner:=old.owner_user_id;v_month:=old.invoice_month;
    v_card:=old.card_id;v_box:=old.box_id;v_kind:=old.kind;v_amount:=old.amount_cents;
  else
    v_owner:=new.owner_user_id;v_month:=new.invoice_month;
    v_card:=new.card_id;v_box:=new.box_id;v_kind:=new.kind;v_amount:=new.amount_cents;
  end if;
  insert into public.finance_periods(owner_user_id,month) values(v_owner,v_month)
    on conflict (owner_user_id,month) do nothing;
  select status into v_status from public.finance_periods where owner_user_id=v_owner
    and month=v_month for update;
  if v_status<>'open' then raise exception 'Mes fechado. Reabra antes de alterar ajustes da fatura.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_owner::text||v_card::text||v_month::text||v_box::text, 0));
  select coalesce(sum(amount_cents),0) into v_total from public.finance_entries
    where owner_user_id=v_owner and card_id=v_card and box_id=v_box
      and competence_month=v_month;
  select v_total + coalesce(sum(case when kind='debit' then amount_cents
      else -amount_cents end),0) into v_total from public.finance_card_adjustments
    where owner_user_id=v_owner and card_id=v_card and box_id=v_box and invoice_month=v_month;
  select coalesce(sum(amount_cents),0) into v_paid from public.finance_card_payments
    where owner_user_id=v_owner and card_id=v_card and box_id=v_box and invoice_month=v_month;
  if tg_op='INSERT' then
    v_total:=v_total+(case when v_kind='debit' then v_amount else -v_amount end);
  else
    v_total:=v_total-(case when v_kind='debit' then v_amount else -v_amount end);
  end if;
  if v_total<0 or v_paid>v_total then
    raise exception 'Ajuste supera o total da fatura ou deixaria pagamentos acima do saldo.'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
create trigger finance_card_adjustment_guard_trg
before insert or update or delete on public.finance_card_adjustments
for each row execute function private.finance_card_adjustment_guard();

create or replace function private.finance_card_payment_guard()
returns trigger language plpgsql set search_path='' as $$
declare v_owner uuid; v_month date; v_status text; v_total bigint; v_paid bigint;
begin
  if tg_op='UPDATE' then raise exception 'Pagamento de fatura nao pode ser editado. Estorne e registre novamente.'; end if;
  v_owner:=case when tg_op='DELETE' then old.owner_user_id else new.owner_user_id end;
  v_month:=date_trunc('month',(case when tg_op='DELETE' then old.paid_at else new.paid_at end)
    at time zone 'America/Sao_Paulo')::date;
  insert into public.finance_periods(owner_user_id,month) values(v_owner,v_month)
    on conflict(owner_user_id,month) do nothing;
  select status into v_status from public.finance_periods where owner_user_id=v_owner
    and month=v_month for update;
  if v_status<>'open' then raise exception 'Mes fechado. Reabra para alterar pagamento de fatura.'; end if;
  if tg_op='DELETE' then return old; end if;
  if not exists(select 1 from public.finance_banks b where b.id=new.bank_id
      and b.owner_user_id=v_owner and b.active) then
    raise exception 'Escolha um banco real ativo para pagar a fatura.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.owner_user_id::text||new.card_id::text||new.invoice_month::text||new.box_id::text,0));
  select coalesce(sum(amount_cents),0) into v_total from public.finance_entries
    where owner_user_id=v_owner and card_id=new.card_id
      and box_id=new.box_id and competence_month=new.invoice_month;
  select v_total+coalesce(sum(case when kind='debit' then amount_cents else -amount_cents end),0)
    into v_total from public.finance_card_adjustments
    where owner_user_id=v_owner and card_id=new.card_id
      and invoice_month=new.invoice_month and box_id=new.box_id;
  select coalesce(sum(amount_cents),0) into v_paid from public.finance_card_payments
    where owner_user_id=v_owner and card_id=new.card_id and
      invoice_month=new.invoice_month and box_id=new.box_id;
  if v_total<=0 then raise exception 'Fatura vazia ou totalmente estornada.'; end if;
  if v_paid+new.amount_cents>v_total then
    raise exception 'Pagamento supera o saldo pendente da fatura neste caixa.'; end if;
  return new;
end $$;

alter table public.finance_card_adjustments enable row level security;
alter table public.finance_card_adjustments force row level security;
create policy finance_owner on public.finance_card_adjustments for all to authenticated
 using(owner_user_id=(select auth.uid()) and exists(select 1 from public.user_roles
   where user_id=(select auth.uid()) and role='admin'))
 with check(owner_user_id=(select auth.uid()) and exists(select 1 from public.user_roles
   where user_id=(select auth.uid()) and role='admin'));
grant select,insert,update,delete on public.finance_card_adjustments to authenticated;
grant all on public.finance_card_adjustments to service_role;
revoke all on public.finance_card_adjustments from anon;

-- Valor confirmado no documento do Inter: R$3.037,26 em compras menos
-- R$503,76 de abatimentos = R$2.533,50 de fatura liquida.
insert into public.finance_card_adjustments
 (owner_user_id,card_id,invoice_month,box_id,kind,title,amount_cents,notes)
select c.owner_user_id,c.id,'2026-11-01',x.id,'credit',
  'Abatimentos e créditos da fatura Inter',50376,
  'Conciliação do extrato enviado: compras R$3.037,26, créditos/antecipações R$503,76; total da fatura R$2.533,50. Caixa Leandro é classificação provisória das compras importadas; revisar origem e responsável antes de efetivar o pagamento. [CARDADJ-INTER-NOV2026]'
from public.finance_cards c
join public.finance_boxes x on x.owner_user_id=c.owner_user_id and x.name='Leandro'
where c.name='Cartão Inter'
  and exists(select 1 from public.finance_entries e where e.card_id=c.id
    and e.box_id=x.id and e.competence_month='2026-11-01')
  and not exists(select 1 from public.finance_card_adjustments a
    where a.card_id=c.id and a.invoice_month='2026-11-01'
      and a.box_id=x.id and a.notes like '%[CARDADJ-INTER-NOV2026]%');
