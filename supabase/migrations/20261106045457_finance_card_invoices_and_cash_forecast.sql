-- Planejamento financeiro: cartoes como obrigacoes, pagamento real como saida bancaria,
-- recebimentos previstos separados de valores efetivamente recebidos.
create table public.finance_cards (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  legacy_bank_id uuid not null,
  default_payment_bank_id uuid,
  due_day smallint not null check (due_day between 1 and 31),
  closing_day smallint check (closing_day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, owner_user_id),
  foreign key (legacy_bank_id, owner_user_id) references public.finance_banks (id,owner_user_id),
  foreign key (default_payment_bank_id, owner_user_id) references public.finance_banks (id,owner_user_id)
);
create unique index finance_cards_name_uq on public.finance_cards (owner_user_id, lower(btrim(name)));

alter table public.finance_entries add column card_id uuid;
alter table public.finance_entries add constraint finance_entries_card_owner_fk
  foreign key (card_id, owner_user_id) references public.finance_cards (id,owner_user_id);
alter table public.finance_entries add constraint finance_entries_card_pending_ck
  check (card_id is null or (kind='expense' and status='pending'));
create index finance_entries_card_month_box_idx on public.finance_entries
  (owner_user_id,card_id,competence_month,box_id) where card_id is not null;

insert into public.finance_cards (owner_user_id,name,legacy_bank_id,default_payment_bank_id,due_day,closing_day)
select b.owner_user_id,
  case b.name when 'Inter' then 'Cartão Inter'
              when 'Mercado Pago' then 'Cartão Mercado Pago'
              when 'Sicredi' then 'Cartão Sicredi'
              when 'Cartão Carrefour' then 'Cartão Carrefour'
              when 'Cartão Bradesco' then 'Cartão Bradesco' end,
  b.id,
  case when b.name in ('Inter','Mercado Pago') then b.id else null end,
  case b.name when 'Inter' then 7 when 'Mercado Pago' then 9
              when 'Sicredi' then 5 else 10 end,
  case when b.name='Mercado Pago' then 2 else null end
from public.finance_banks b
where b.name in ('Inter','Mercado Pago','Sicredi','Cartão Carrefour','Cartão Bradesco')
  and exists (select 1 from public.finance_entries e where e.owner_user_id=b.owner_user_id
    and e.bank_id=b.id and e.notes like '%[CARDIMPORT-202611-%')
on conflict do nothing;

update public.finance_entries e set card_id=c.id
from public.finance_cards c
where c.owner_user_id=e.owner_user_id and c.legacy_bank_id=e.bank_id
  and e.kind='expense' and e.status='pending' and e.card_id is null
  and e.notes like '%[CARDIMPORT-202611-%';

create table public.finance_card_payments (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  card_id uuid not null,
  invoice_month date not null check (extract(day from invoice_month)=1),
  bank_id uuid not null,
  box_id uuid not null,
  amount_cents bigint not null check (amount_cents between 1 and 999999999999),
  paid_at timestamptz not null,
  notes text check (notes is null or char_length(notes)<=1000),
  client_token uuid not null,
  created_at timestamptz not null default now(),
  unique (id,owner_user_id),
  unique (owner_user_id,client_token),
  foreign key(card_id,owner_user_id) references public.finance_cards(id,owner_user_id),
  foreign key(bank_id,owner_user_id) references public.finance_banks(id,owner_user_id),
  foreign key(box_id,owner_user_id) references public.finance_boxes(id,owner_user_id)
);
create index finance_card_payments_card_idx on public.finance_card_payments
  (owner_user_id,card_id,invoice_month,box_id);
create index finance_card_payments_bank_idx on public.finance_card_payments
  (owner_user_id,bank_id,box_id,paid_at);

create table public.finance_expected_incomes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  bank_id uuid not null,
  box_id uuid not null,
  title text not null check (char_length(btrim(title)) between 2 and 160),
  amount_cents bigint not null check (amount_cents between 1 and 999999999999),
  expected_on date not null,
  status text not null default 'expected' check(status in ('expected','received','cancelled')),
  received_at timestamptz,
  notes text check(notes is null or char_length(notes)<=1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,owner_user_id),
  foreign key(bank_id,owner_user_id) references public.finance_banks(id,owner_user_id),
  foreign key(box_id,owner_user_id) references public.finance_boxes(id,owner_user_id),
  check((status='received' and received_at is not null) or
        (status<>'received' and received_at is null))
);
create index finance_expected_incomes_dates_idx on public.finance_expected_incomes
  (owner_user_id,expected_on,status);

create function private.finance_card_payment_guard()
returns trigger language plpgsql set search_path='' as $$
declare v_owner uuid; v_month date; v_status text; v_total bigint; v_paid bigint;
begin
  if tg_op='UPDATE' then raise exception 'Pagamento de fatura nao pode ser editado. Estorne e registre novamente.'; end if;
  v_owner := case when tg_op='DELETE' then old.owner_user_id else new.owner_user_id end;
  v_month := date_trunc('month', (case when tg_op='DELETE' then old.paid_at else new.paid_at end) at time zone 'America/Sao_Paulo')::date;
  insert into public.finance_periods(owner_user_id,month) values (v_owner,v_month)
    on conflict (owner_user_id,month) do nothing;
  select p.status into v_status from public.finance_periods p
    where p.owner_user_id=v_owner and p.month=v_month for update;
  if v_status<>'open' then raise exception 'Mes fechado. Reabra para alterar pagamento de fatura.'; end if;
  if tg_op='DELETE' then return old; end if;
  if not exists(select 1 from public.finance_banks b where b.id=new.bank_id
      and b.owner_user_id=v_owner and b.active=true) then
    raise exception 'Escolha um banco real ativo para pagar a fatura.'; end if;
  -- Serializa pagamentos da mesma fatura/caixa contra cliques simultaneos.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    new.owner_user_id::text||new.card_id::text||new.invoice_month::text||new.box_id::text, 0));
  select coalesce(sum(e.amount_cents),0) into v_total
    from public.finance_entries e where e.owner_user_id=v_owner
      and e.card_id=new.card_id and e.box_id=new.box_id
      and e.competence_month=new.invoice_month;
  select coalesce(sum(p.amount_cents),0) into v_paid
    from public.finance_card_payments p where p.owner_user_id=v_owner
      and p.card_id=new.card_id and p.invoice_month=new.invoice_month and p.box_id=new.box_id;
  if v_total=0 then raise exception 'Fatura vazia para o caixa selecionado.'; end if;
  if v_paid+new.amount_cents>v_total then
    raise exception 'Pagamento supera o saldo pendente da fatura neste caixa.'; end if;
  return new;
end $$;
create trigger finance_card_payment_guard_trg before insert or update or delete on public.finance_card_payments
for each row execute function private.finance_card_payment_guard();

create function private.finance_card_charge_guard()
returns trigger language plpgsql set search_path='' as $$
declare v_linked boolean; 
begin
  if tg_op='INSERT' then return new; end if;
  if old.card_id is null then return case when tg_op='DELETE' then old else new end; end if;
  if tg_op='DELETE' or (new.card_id is distinct from old.card_id
       or new.box_id is distinct from old.box_id or
       new.competence_month is distinct from old.competence_month or
       new.amount_cents is distinct from old.amount_cents) then
    select exists (select 1 from public.finance_card_payments p where
      p.owner_user_id=old.owner_user_id and p.card_id=old.card_id and
      p.invoice_month=old.competence_month and p.box_id=old.box_id) into v_linked;
    if v_linked then raise exception 'Fatura com pagamentos: estorne os pagamentos antes de alterar valor, caixa, mes ou excluir compra.'; end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger finance_card_charge_guard_trg before insert or update or delete on public.finance_entries
for each row execute function private.finance_card_charge_guard();

create function private.finance_expected_income_guard()
returns trigger language plpgsql set search_path='' as $$
declare v_owner uuid; v_month date; v_status text;
begin
  if tg_op='UPDATE' and old.owner_user_id<>new.owner_user_id then
    raise exception 'Nao e permitido transferir o proprietario.'; end if;
  v_owner := case when tg_op='DELETE' then old.owner_user_id else new.owner_user_id end;
  for v_month in select distinct x.mon from (
    select case when tg_op in ('UPDATE','DELETE') then date_trunc('month',old.expected_on)::date end as mon
    union all select case when tg_op in ('INSERT','UPDATE') then date_trunc('month',new.expected_on)::date end
    union all select case when tg_op in ('UPDATE','DELETE') and old.received_at is not null
      then date_trunc('month',old.received_at at time zone 'America/Sao_Paulo')::date end
    union all select case when tg_op in ('INSERT','UPDATE') and new.received_at is not null
      then date_trunc('month',new.received_at at time zone 'America/Sao_Paulo')::date end
  ) x where x.mon is not null order by 1 loop
    insert into public.finance_periods(owner_user_id,month) values(v_owner,v_month)
       on conflict(owner_user_id,month) do nothing;
    select status into v_status from public.finance_periods
      where owner_user_id=v_owner and month=v_month for update;
    if v_status<>'open' then raise exception 'Mes fechado. Reabra o periodo para alterar previsoes.'; end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  if new.status='received' and not exists(select 1 from public.finance_banks b
    where b.id=new.bank_id and b.owner_user_id=v_owner and b.active) then
    raise exception 'Recebimento exige banco ativo.'; end if;
  new.updated_at:=now();
  return new;
end $$;
create trigger finance_expected_income_guard_trg before insert or update or delete on public.finance_expected_incomes
for each row execute function private.finance_expected_income_guard();

-- Periodos podem fechar com compras a credito pendentes.
-- As faturas continuam acompanhadas no passivo sem reduzir o caixa.
create or replace function private.finance_period_guard()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and
     (new.owner_user_id <> old.owner_user_id or new.month <> old.month) then
    raise exception 'Nao e permitido alterar o identificador do periodo.';
  end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    if exists (
      select 1 from public.finance_entries
      where owner_user_id = new.owner_user_id and competence_month = new.month
      and status = 'pending' and card_id is null
    ) then
      raise exception 'Existem contas de banco pendentes neste mes. Pague ou reprograme antes de fechar.';
    end if;
    new.closed_at := now();
  elsif new.status = 'open' then
    new.closed_at := null;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['finance_cards','finance_card_payments','finance_expected_incomes']
  loop
    execute format('alter table public.%I enable row level security',t);
    execute format('alter table public.%I force row level security',t);
    execute format(
      'create policy finance_owner on public.%I for all to authenticated
       using (owner_user_id = (select auth.uid()) and exists
         (select 1 from public.user_roles where user_id = (select auth.uid()) and role = ''admin''))
       with check (owner_user_id = (select auth.uid()) and exists
         (select 1 from public.user_roles where user_id = (select auth.uid()) and role = ''admin''))',t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('revoke all on public.%I from anon',t);
  end loop;
end $$;
