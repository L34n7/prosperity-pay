-- Protege pagamentos de faturas durante a propagacao e o encerramento
-- de assinaturas. Classificacoes historicas continuam auditadas.
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
    and future.status='pending'
    and not exists(select 1 from public.finance_card_payments p
      where p.owner_user_id=future.owner_user_id and p.card_id=future.card_id
        and p.box_id=future.box_id and p.invoice_month=future.competence_month);
 end if;
 return new;
end $$;

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
  and not exists(select 1 from public.finance_card_payments p
    where p.owner_user_id=future.owner_user_id and p.card_id=future.card_id
      and p.box_id=future.box_id and p.invoice_month=future.competence_month)
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

 -- Faturas com pagamentos registrados podem receber classificacao textual,
 -- mas nao podem ter sua referencia financeira, caixa ou valor reescritos.
 if exists(
  select 1 from public.finance_entries past
  join public.finance_card_payments p on p.owner_user_id=past.owner_user_id
    and p.card_id=past.card_id and p.box_id=past.box_id
    and p.invoice_month=past.competence_month
  where past.owner_user_id=v_owner and past.id<>p_id and past.kind='expense'
   and (
    (v_original.installment_series_id is not null and past.installment_series_id=v_original.installment_series_id
       and past.installment_number<v_original.installment_number)
    or (v_original.subscription_series_id is not null and past.subscription_series_id=v_original.subscription_series_id
       and past.competence_month<v_original.competence_month)
   )
   and (past.amount_cents,past.card_id,past.box_id) is distinct from
       (v_updated.amount_cents,v_updated.card_id,v_updated.box_id)
 ) then raise exception 'Existem faturas anteriores com pagamentos. Nao e permitido alterar valor, cartao ou caixa dessas faturas.'; end if;

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

