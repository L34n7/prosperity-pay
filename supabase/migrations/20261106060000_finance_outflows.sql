-- Lançamentos pontuais de saída de banco não são contas a pagar.
-- O tipo outflow baixa o saldo real, mas aparece somente em movimentações.
alter table public.finance_entries
  drop constraint finance_entries_kind_check;
alter table public.finance_entries
  add constraint finance_entries_kind_check
  check (kind in ('opening','income','expense','transfer','outflow'));

do $$
declare updated_count integer;
begin
  update public.finance_entries
    set kind = 'outflow',
        due_on = null
  where title = 'Pix enviado Durval Miranda'
    and amount_cents = 1100
    and kind = 'expense'
    and status = 'paid'
    and card_id is null
    and notes like '%[EXTRACT-202611-INTER-DURVAL-1100]%';
  get diagnostics updated_count = row_count;
  if updated_count <> 1 then
    raise exception 'Esperava 1 Pix Durval pendente de reclassificacao, encontrado %', updated_count;
  end if;
end $$;
