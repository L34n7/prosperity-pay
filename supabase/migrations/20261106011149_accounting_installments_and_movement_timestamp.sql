-- A contabilidade interna passa a registrar horario real e vincular parcelas.
-- Lançamentos antigos preservam a data local; sem hora anterior registrada, usam meio-dia.
alter table public.finance_entries
  add column movement_at timestamptz,
  add column installment_series_id uuid,
  add column installment_number integer,
  add column installment_total integer;

update public.finance_entries
set movement_at = settled_on::timestamp at time zone 'America/Sao_Paulo'
where status = 'paid' and settled_on is not null;

alter table public.finance_entries
  add constraint finance_entries_payment_time_chk
  check ((status = 'paid' and movement_at is not null) or (status = 'pending' and movement_at is null)),
  add constraint finance_entries_installment_chk
  check (
    (installment_series_id is null and installment_number is null and installment_total is null)
    or
    (kind = 'expense' and installment_series_id is not null
      and installment_total between 2 and 120
      and installment_number between 1 and installment_total)
  );

create unique index finance_entries_installment_uq
  on public.finance_entries(owner_user_id, installment_series_id, installment_number)
  where installment_series_id is not null;
create index finance_entries_series_idx
  on public.finance_entries(owner_user_id, installment_series_id)
  where installment_series_id is not null;
