-- Assinaturas mensais independentes de parcelamento, auditoria imutável,
-- e edicoes em series com historico preservado.
alter table public.finance_entries drop constraint if exists finance_entries_category_check;
alter table public.finance_entries add constraint finance_entries_category_check
check (category in (
'alimentacao','transporte','automovel','moradia','tecnologia','assinaturas',
'hospedagem','saude','lazer','vestuario','casa','compras','marketing','impostos',
'taxas','servicos','educacao','seguros','produto','outros'
));

create table public.finance_subscriptions (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references public.profiles(id) on delete cascade,
 start_on date not null,
 due_day integer not null check(due_day between 1 and 31),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(id,owner_user_id)
);
alter table public.finance_subscriptions enable row level security;
alter table public.finance_subscriptions force row level security;
create policy finance_subscriptions_owner on public.finance_subscriptions for all to authenticated
 using (owner_user_id=(select auth.uid()) and exists
  (select 1 from public.user_roles where user_id=(select auth.uid()) and role='admin'))
 with check (owner_user_id=(select auth.uid()) and exists
  (select 1 from public.user_roles where user_id=(select auth.uid()) and role='admin'));
grant select,insert,update,delete on public.finance_subscriptions to authenticated;
grant all on public.finance_subscriptions to service_role;
revoke all on public.finance_subscriptions from anon;

alter table public.finance_entries
 add column subscription_series_id uuid,
 add column is_subscription boolean not null default false;
alter table public.finance_entries
 add constraint finance_entry_subscription_owner_fk
 foreign key(subscription_series_id,owner_user_id)
 references public.finance_subscriptions(id,owner_user_id);
alter table public.finance_entries
 add constraint finance_entry_subscription_kind_ck
 check(subscription_series_id is null or kind='expense');
alter table public.finance_entries
 add constraint finance_entry_subscription_not_installment_ck
 check(not(is_subscription and installment_series_id is not null));
alter table public.finance_entries
 add constraint finance_entry_subscription_id_ck
 check(not is_subscription or subscription_series_id is not null);
create unique index finance_entry_subscription_month_uq
 on public.finance_entries(owner_user_id,subscription_series_id,competence_month)
 where subscription_series_id is not null;
create index finance_entry_subscription_series_idx
 on public.finance_entries(owner_user_id,subscription_series_id,competence_month)
 where subscription_series_id is not null;

-- Histórico append-only. O usuario autenticado consegue apenas CONSULTAR o seu,
-- e somente o gatilho interno tem autorizacao para escrever os registros.
create table public.finance_entry_history (
 id bigint generated always as identity primary key,
 owner_user_id uuid not null references public.profiles(id) on delete cascade,
 entry_id uuid not null,
 actor_user_id uuid,
 operation text not null check(operation in ('INSERT','UPDATE','DELETE')),
 previous_data jsonb,
 next_data jsonb,
 changed_at timestamptz not null default now(),
 transaction_id bigint not null,
 source text not null default 'app'
);
create index finance_entry_history_owner_entry_idx
 on public.finance_entry_history(owner_user_id,entry_id,changed_at desc);
alter table public.finance_entry_history enable row level security;
alter table public.finance_entry_history force row level security;
create policy finance_entry_history_owner_read on public.finance_entry_history
 for select to authenticated using
 (owner_user_id=(select auth.uid()) and exists
  (select 1 from public.user_roles where user_id=(select auth.uid()) and role='admin'));
grant select on public.finance_entry_history to authenticated;
grant all on public.finance_entry_history to service_role;
revoke all on public.finance_entry_history from anon;
revoke insert,update,delete,truncate on public.finance_entry_history from authenticated;

create or replace function private.finance_entry_audit()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and to_jsonb(old) - 'updated_at' is not distinct from to_jsonb(new) - 'updated_at'
 then return new; end if;
 insert into public.finance_entry_history(owner_user_id,entry_id,actor_user_id,operation,
  previous_data,next_data,transaction_id,source)
 values (
  case when tg_op='DELETE' then old.owner_user_id else new.owner_user_id end,
  case when tg_op='DELETE' then old.id else new.id end,
  auth.uid(),tg_op,
  case when tg_op='INSERT' then null else to_jsonb(old) end,
  case when tg_op='DELETE' then null else to_jsonb(new) end,
  txid_current(),
  coalesce(nullif(current_setting('app.finance_source',true),''),'app')
 );
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.finance_entry_audit() from public,anon,authenticated;
create trigger finance_entry_history_audit_trg after insert or update or delete
 on public.finance_entries for each row execute function private.finance_entry_audit();

-- Quando marcada, a flag cria uma regra mensal na mesma transacao do registro.
-- Desmarcar encerra a regra e apaga somente vencimentos futuros nao pagos;
-- todos os snapshots permanecem no finance_entry_history.
create or replace function private.finance_prepare_subscription()
returns trigger language plpgsql set search_path='' as $$
declare v_id uuid;
begin
 if new.is_subscription and (new.kind<>'expense' or new.installment_series_id is not null) then
  raise exception 'Assinatura so pode ser usada em conta sem parcelamento.';
 end if;
 if tg_op='UPDATE' and old.subscription_series_id is not null and
    new.subscription_series_id is distinct from old.subscription_series_id then
  raise exception 'Nao e permitido trocar a serie de uma assinatura.';
 end if;
 if new.is_subscription and new.subscription_series_id is null then
  if new.due_on is null then raise exception 'Informe o vencimento da assinatura.'; end if;
  insert into public.finance_subscriptions(owner_user_id,start_on,due_day)
   values(new.owner_user_id,new.due_on,extract(day from new.due_on)::int)
   returning id into v_id;
  new.subscription_series_id:=v_id;
 elsif tg_op='UPDATE' and new.subscription_series_id is not null and new.is_subscription then
  if not old.is_subscription or new.due_on is distinct from old.due_on then
   update public.finance_subscriptions set active=true,
    due_day=extract(day from new.due_on)::integer,updated_at=now()
   where id=new.subscription_series_id and owner_user_id=new.owner_user_id;
  end if;
 end if;
 return new;
end $$;
create trigger finance_prepare_subscription_trg before insert or update of is_subscription,due_on
 on public.finance_entries for each row execute function private.finance_prepare_subscription();

create or replace function private.finance_stop_subscription()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.is_subscription and not new.is_subscription and new.subscription_series_id is not null then
  update public.finance_subscriptions set active=false,updated_at=now()
   where id=new.subscription_series_id and owner_user_id=new.owner_user_id;
  delete from public.finance_entries future
   where future.owner_user_id=new.owner_user_id
    and future.subscription_series_id=new.subscription_series_id
    and future.competence_month>new.competence_month
    and future.status='pending';
 end if;
 return new;
end $$;
create trigger finance_stop_subscription_trg after update of is_subscription
 on public.finance_entries for each row
 when(old.is_subscription is distinct from new.is_subscription)
 execute function private.finance_stop_subscription();

-- Um unico mecanismo para os ajustes de categoria, caixa, banco/cartao etc.
-- Propaga SOMENTE a parcelas futuras pendentes, preservando mudancas especificas
-- que divergem do valor anterior do registro alterado.
drop trigger if exists finance_entries_cascade_box_trg on public.finance_entries;
drop function if exists private.finance_cascade_installment_box();
create or replace function private.finance_cascade_series_configuration()
returns trigger language plpgsql set search_path='' as $$
begin
 if pg_trigger_depth()>1 or new.kind<>'expense'
  or (new.installment_series_id is null and new.subscription_series_id is null)
  or current_setting('app.finance_skip_series_cascade',true)='1'
 then return new; end if;
 update public.finance_entries future set
   title=case when future.title is not distinct from old.title then new.title else future.title end,
   category=case when future.category is not distinct from old.category then new.category else future.category end,
   box_id=case when future.box_id is not distinct from old.box_id then new.box_id else future.box_id end,
   bank_id=case when future.bank_id is not distinct from old.bank_id then new.bank_id else future.bank_id end,
   card_id=case when future.card_id is not distinct from old.card_id then new.card_id else future.card_id end,
   origin_id=case when future.origin_id is not distinct from old.origin_id then new.origin_id else future.origin_id end,
   amount_cents=case when future.amount_cents is not distinct from old.amount_cents then new.amount_cents else future.amount_cents end,
   notes=case when future.notes is not distinct from old.notes then new.notes else future.notes end
 where future.owner_user_id=new.owner_user_id and future.kind='expense' and future.status='pending'
  and future.id<>new.id
  and (
   (new.installment_series_id is not null and future.installment_series_id=new.installment_series_id
     and future.installment_number>new.installment_number)
   or (new.subscription_series_id is not null and future.subscription_series_id=new.subscription_series_id
     and future.competence_month>new.competence_month)
  )
  and not exists(select 1 from public.finance_periods p
   where p.owner_user_id=future.owner_user_id and p.month=future.competence_month and p.status='closed')
  and (
    (new.title is distinct from old.title and future.title is not distinct from old.title)
    or (new.category is distinct from old.category and future.category is not distinct from old.category)
    or (new.box_id is distinct from old.box_id and future.box_id is not distinct from old.box_id)
    or (new.bank_id is distinct from old.bank_id and future.bank_id is not distinct from old.bank_id)
    or (new.card_id is distinct from old.card_id and future.card_id is not distinct from old.card_id)
    or (new.origin_id is distinct from old.origin_id and future.origin_id is not distinct from old.origin_id)
    or (new.amount_cents is distinct from old.amount_cents and future.amount_cents is not distinct from old.amount_cents)
    or (new.notes is distinct from old.notes and future.notes is not distinct from old.notes)
  );
 return new;
end $$;
create trigger finance_cascade_series_config_trg after update of
 title,category,box_id,bank_id,card_id,origin_id,amount_cents,notes
 on public.finance_entries for each row execute function private.finance_cascade_series_configuration();

-- Gera ate 12 meses seguintes ou ate o mes consultado (dentro de 10 anos).
-- Executado de forma idempotente pelo servidor; banco bloqueia a regra para
-- evitar corridas entre acessos simultaneos.
create or replace function public.finance_ensure_subscriptions(p_until date)
returns integer language plpgsql security invoker set search_path='' as $$
declare
 v_owner uuid:=auth.uid();
 v_end date;
 v_next date;
 v_due date;
 v_last_day integer;
 v_rule record;
 v_prior public.finance_entries%rowtype;
 v_new public.finance_entries%rowtype;
 v_count integer:=0;
begin
 if v_owner is null then raise exception 'Autenticacao necessaria.'; end if;
 if p_until is null then raise exception 'Mes solicitado invalido.'; end if;
 v_end:=date_trunc('month',greatest(
   p_until,(timezone('America/Sao_Paulo',now())::date+interval '12 months')::date))::date;
 if v_end>(date_trunc('month',now())+interval '120 months')::date
 then raise exception 'Periodo de recorrencia superior a 10 anos.'; end if;
 for v_rule in
  select id,due_day from public.finance_subscriptions
  where owner_user_id=v_owner and active for update
 loop
  select * into v_prior from public.finance_entries
   where owner_user_id=v_owner and subscription_series_id=v_rule.id
    and is_subscription=true
   order by competence_month desc limit 1;
  if not found then continue; end if;
  v_next:=(date_trunc('month',v_prior.due_on)+interval '1 month')::date;
  while v_next<=v_end loop
   if not exists (select 1 from public.finance_periods where owner_user_id=v_owner
     and month=v_next and status='closed') then
    v_last_day:=extract(day from (v_next+interval '1 month - 1 day'))::int;
    v_due:=v_next+(least(v_rule.due_day,v_last_day)-1);
    insert into public.finance_entries
     (owner_user_id,bank_id,box_id,origin_id,kind,status,title,category,amount_cents,
       competence_month,due_on,settled_on,movement_at,notes,card_id,subscription_series_id,is_subscription)
    values
     (v_owner,v_prior.bank_id,v_prior.box_id,v_prior.origin_id,
      'expense','pending',v_prior.title,v_prior.category,v_prior.amount_cents,
      v_next,v_due,null,null,v_prior.notes,v_prior.card_id,v_rule.id,true)
    on conflict do nothing returning * into v_new;
    if found then v_prior:=v_new;v_count:=v_count+1;
    else
     select * into v_prior from public.finance_entries where owner_user_id=v_owner
      and subscription_series_id=v_rule.id and competence_month=v_next;
    end if;
   end if;
   v_next:=(v_next+interval '1 month')::date;
  end loop;
 end loop;
 return v_count;
end $$;
revoke all on function public.finance_ensure_subscriptions(date) from public,anon;
grant execute on function public.finance_ensure_subscriptions(date) to authenticated,service_role;

-- Modal com "Aplicar ajustes no passado": operacao atomica com auditoria
-- de cada linha modificada. Status/pagamento e vencimento dos meses passados
-- permanecem intocados; so informacoes da conta sao harmonizadas.
create or replace function public.finance_update_entry_with_past(p_id uuid,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 v_owner uuid:=auth.uid();
 v_original public.finance_entries%rowtype;
 v_updated public.finance_entries%rowtype;
 v_count integer:=0;
begin
 if v_owner is null then raise exception 'Autenticacao necessaria.'; end if;
 select * into v_original from public.finance_entries
   where owner_user_id=v_owner and id=p_id for update;
 if not found then raise exception 'Conta nao encontrada.'; end if;
 if v_original.kind<>'expense'
   or (v_original.installment_series_id is null and v_original.subscription_series_id is null)
 then raise exception 'Aplicar no passado requer conta parcelada ou assinatura.'; end if;

 -- As validacoes de payload sao feitas pela API antes da chamada. A funcao
 -- impede alterar propriedade, tipo, ids de serie e passado fechado.
 update public.finance_entries set
   title=(p_data->>'title'),
   category=(p_data->>'category'),
   amount_cents=(p_data->>'amount_cents')::bigint,
   bank_id=(p_data->>'bank_id')::uuid,
   box_id=(p_data->>'box_id')::uuid,
   card_id=nullif(p_data->>'card_id','')::uuid,
   origin_id=nullif(p_data->>'origin_id','')::uuid,
   status=(p_data->>'status'),
   due_on=nullif(p_data->>'due_on','')::date,
   settled_on=nullif(p_data->>'settled_on','')::date,
   movement_at=nullif(p_data->>'movement_at','')::timestamptz,
   competence_month=(p_data->>'competence_month')::date,
   notes=p_data->>'notes',
   is_subscription=coalesce((p_data->>'is_subscription')::boolean,is_subscription)
 where owner_user_id=v_owner and id=p_id returning * into v_updated;
 if not found then raise exception 'Falha ao alterar conta.'; end if;

 if exists (
  select 1 from public.finance_entries past
   join public.finance_periods period on period.owner_user_id=past.owner_user_id
     and period.month=past.competence_month and period.status='closed'
  where past.owner_user_id=v_owner and past.id<>p_id
   and (
    (v_original.installment_series_id is not null and past.installment_series_id=v_original.installment_series_id
      and past.installment_number<v_original.installment_number)
    or (v_original.subscription_series_id is not null and past.subscription_series_id=v_original.subscription_series_id
      and past.competence_month<v_original.competence_month)
   )
 ) then raise exception 'O passado tem meses fechados. Reabra os periodos para alterar.'; end if;

 update public.finance_entries past set
  title=v_updated.title,category=v_updated.category,
  amount_cents=v_updated.amount_cents,box_id=v_updated.box_id,
  bank_id=case when past.status='paid' then past.bank_id else v_updated.bank_id end,
  card_id=case when past.status='paid' then past.card_id else v_updated.card_id end,
  origin_id=v_updated.origin_id,notes=v_updated.notes
 where past.owner_user_id=v_owner and past.id<>p_id and past.kind='expense'
  and (
   (v_original.installment_series_id is not null and past.installment_series_id=v_original.installment_series_id
     and past.installment_number<v_original.installment_number)
   or (v_original.subscription_series_id is not null and past.subscription_series_id=v_original.subscription_series_id
     and past.competence_month<v_original.competence_month)
  )
  and (
   (past.title,past.category,past.amount_cents,past.box_id,past.origin_id,past.notes)
     is distinct from
   (v_updated.title,v_updated.category,v_updated.amount_cents,v_updated.box_id,v_updated.origin_id,v_updated.notes)
   or (past.status='pending' and
    (past.bank_id,past.card_id) is distinct from (v_updated.bank_id,v_updated.card_id))
  );
 get diagnostics v_count=row_count;
 return jsonb_build_object('record',to_jsonb(v_updated),'past_updated',v_count);
end $$;
revoke all on function public.finance_update_entry_with_past(uuid,jsonb) from public,anon;
grant execute on function public.finance_update_entry_with_past(uuid,jsonb) to authenticated,service_role;
