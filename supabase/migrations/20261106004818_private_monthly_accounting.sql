-- Controle financeiro privado: bancos reais, caixas virtuais e fechamento mensal.
-- Independente das carteiras transacionais de vendas/comissoes Prosperity Pay.
create table public.finance_banks (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(id, owner_user_id)
);
create unique index finance_banks_name_uq on public.finance_banks(owner_user_id, lower(btrim(name)));

create table public.finance_boxes (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  person_type text not null check (person_type in ('pf','pj')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(id, owner_user_id)
);
create unique index finance_boxes_name_uq on public.finance_boxes(owner_user_id, lower(btrim(name)));

create table public.finance_origins (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 2 and 100),
  created_at timestamptz not null default now(),
  unique(id, owner_user_id)
);
create unique index finance_origins_name_uq on public.finance_origins(owner_user_id, lower(btrim(name)));

create table public.finance_periods (
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  primary key (owner_user_id, month),
  check ((status = 'open' and closed_at is null) or (status = 'closed' and closed_at is not null))
);

create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  bank_id uuid not null,
  box_id uuid not null,
  target_bank_id uuid,
  target_box_id uuid,
  origin_id uuid,
  kind text not null check (kind in ('opening','income','expense','transfer')),
  status text not null check (status in ('pending','paid')),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  amount_cents bigint not null check (amount_cents between 1 and 999999999999),
  competence_month date not null check (extract(day from competence_month) = 1),
  due_on date,
  settled_on date,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (bank_id, owner_user_id) references public.finance_banks(id,owner_user_id),
  foreign key (box_id, owner_user_id) references public.finance_boxes(id,owner_user_id),
  foreign key (target_bank_id, owner_user_id) references public.finance_banks(id,owner_user_id),
  foreign key (target_box_id, owner_user_id) references public.finance_boxes(id,owner_user_id),
  foreign key (origin_id, owner_user_id) references public.finance_origins(id,owner_user_id),
  check (
    (kind = 'transfer' and target_bank_id is not null and target_box_id is not null
      and (bank_id <> target_bank_id or box_id <> target_box_id))
    or (kind <> 'transfer' and target_bank_id is null and target_box_id is null)
  ),
  check (kind = 'expense' or status = 'paid'),
  check ((status = 'paid' and settled_on is not null) or (status = 'pending' and settled_on is null)),
  check (status = 'pending' or competence_month = date_trunc('month', settled_on)::date),
  check (kind <> 'expense' or due_on is not null),
  check (kind <> 'transfer' or origin_id is null)
);
create index finance_entries_month_idx on public.finance_entries(owner_user_id,competence_month,created_at desc);
create index finance_entries_bank_box_idx on public.finance_entries(owner_user_id,bank_id,box_id,competence_month);
create index finance_entries_title_idx on public.finance_entries(owner_user_id,lower(btrim(title)));

-- Bloqueio no banco, inclusive para acesso direto ao Data API.
create function private.finance_entry_guard() returns trigger language plpgsql
set search_path = '' as $$
declare v_owner uuid; v_month date; v_status text;
begin
  if tg_op = 'UPDATE' and new.owner_user_id <> old.owner_user_id then
    raise exception 'Nao e permitido transferir a propriedade de um lancamento.';
  end if;
  v_owner := case when tg_op = 'DELETE' then old.owner_user_id else new.owner_user_id end;
  for v_month in
    select distinct months.month from (
      select case when tg_op in ('UPDATE','DELETE') then old.competence_month else null end as month
      union all
      select case when tg_op in ('UPDATE','INSERT') then new.competence_month else null end
    ) months where months.month is not null order by 1
  loop
    insert into public.finance_periods(owner_user_id,month) values (v_owner,v_month)
      on conflict (owner_user_id,month) do nothing;
    select status into v_status from public.finance_periods
      where owner_user_id = v_owner and month = v_month for update;
    if v_status is distinct from 'open' then
      raise exception 'Mes fechado. Reabra o periodo para editar lancamentos.';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger finance_entry_guard_trg before insert or update or delete on public.finance_entries
for each row execute function private.finance_entry_guard();

create function private.finance_period_guard() returns trigger language plpgsql
set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and
     (new.owner_user_id <> old.owner_user_id or new.month <> old.month) then
    raise exception 'Nao e permitido alterar o identificador do periodo.';
  end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status <> 'closed') then
    if exists (
      select 1 from public.finance_entries
      where owner_user_id = new.owner_user_id and competence_month = new.month
      and status = 'pending'
    ) then
      raise exception 'Existem contas pendentes neste mes. Pague ou reprograme antes de fechar.';
    end if;
    new.closed_at := now();
  elsif new.status = 'open' then
    new.closed_at := null;
  end if;
  return new;
end;
$$;
create trigger finance_period_guard_trg before insert or update on public.finance_periods
for each row execute function private.finance_period_guard();

-- Acesso exclusivo a administradores da plataforma e aos seus proprios dados.
do $$
declare t text;
begin
  foreach t in array array['finance_banks','finance_boxes','finance_origins','finance_periods','finance_entries']
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
