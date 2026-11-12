-- Sincroniza o caixa das parcelas futuras ao corrigir uma parcela de origem.
-- A importacao de faturas gerou as parcelas antecipadamente com o caixa Leandro.
-- Reconciliacao precisa: mesma serie, cartao, valor, total e parcela posterior.
DO $$
DECLARE
  v_candidates integer;
  v_conflicts integer;
  v_updated integer;
BEGIN
  WITH eligible AS (
    SELECT future.id, november.box_id target_box_id
    FROM public.finance_entries november
    JOIN public.finance_entries future
      ON future.owner_user_id=november.owner_user_id
      AND future.installment_series_id=november.installment_series_id
      AND future.card_id IS NOT DISTINCT FROM november.card_id
      AND future.amount_cents=november.amount_cents
      AND future.installment_total=november.installment_total
      AND future.installment_number>november.installment_number
      AND future.competence_month>november.competence_month
    JOIN public.finance_boxes original_box
      ON original_box.id=future.box_id
      AND original_box.owner_user_id=future.owner_user_id
    WHERE november.kind='expense'
      AND november.competence_month='2026-11-01'::date
      AND november.installment_series_id IS NOT NULL
      AND future.kind='expense'
      AND future.status='pending'
      AND original_box.name='Leandro'
      AND future.box_id<>november.box_id
  )
  SELECT COUNT(*),COUNT(*)-COUNT(DISTINCT id)
    INTO v_candidates,v_conflicts
    FROM eligible;
  IF v_conflicts<>0 THEN
    RAISE EXCEPTION 'Conflito: uma parcela futura possui multiplas origens de novembro.';
  END IF;
  IF v_candidates<>51 THEN
    RAISE EXCEPTION 'A conciliacao esperava 51 parcelas futuras, encontrou %. Revise antes de corrigir.',v_candidates;
  END IF;
  WITH eligible AS (
    SELECT future.id, november.box_id target_box_id
    FROM public.finance_entries november
    JOIN public.finance_entries future
      ON future.owner_user_id=november.owner_user_id
      AND future.installment_series_id=november.installment_series_id
      AND future.card_id IS NOT DISTINCT FROM november.card_id
      AND future.amount_cents=november.amount_cents
      AND future.installment_total=november.installment_total
      AND future.installment_number>november.installment_number
      AND future.competence_month>november.competence_month
    JOIN public.finance_boxes original_box
      ON original_box.id=future.box_id
      AND original_box.owner_user_id=future.owner_user_id
    WHERE november.kind='expense'
      AND november.competence_month='2026-11-01'::date
      AND november.installment_series_id IS NOT NULL
      AND future.kind='expense'
      AND future.status='pending'
      AND original_box.name='Leandro'
      AND future.box_id<>november.box_id
  )
  UPDATE public.finance_entries future
  SET box_id=eligible.target_box_id
  FROM eligible
  WHERE future.id=eligible.id;
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>51 THEN RAISE EXCEPTION 'Conciliacao incompleta: % de 51.',v_updated; END IF;
END $$;

-- Mudancas futuras do caixa de uma parcela agora acompanham a mesma compra.
-- Preserva parcelas pagas, meses fechados e caixas ajustados individualmente.
CREATE OR REPLACE FUNCTION private.finance_cascade_installment_box()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=''
AS $$
BEGIN
  IF pg_trigger_depth()>1
    OR new.kind<>'expense'
    OR new.installment_series_id IS NULL
    OR new.installment_number IS NULL
    OR new.installment_total IS NULL
  THEN RETURN new; END IF;

  UPDATE public.finance_entries future
  SET box_id=new.box_id
  WHERE future.owner_user_id=new.owner_user_id
    AND future.kind='expense'
    AND future.status='pending'
    AND future.installment_series_id=new.installment_series_id
    AND future.card_id IS NOT DISTINCT FROM new.card_id
    AND future.installment_total=new.installment_total
    AND abs(future.amount_cents-new.amount_cents)<=1
    AND future.installment_number>new.installment_number
    AND future.competence_month>new.competence_month
    AND future.box_id=old.box_id
    AND NOT EXISTS (
      SELECT 1 FROM public.finance_periods p
      WHERE p.owner_user_id=future.owner_user_id
        AND p.month=future.competence_month
        AND p.status='closed'
    );
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS finance_entries_cascade_box_trg ON public.finance_entries;
CREATE TRIGGER finance_entries_cascade_box_trg
AFTER UPDATE OF box_id ON public.finance_entries
FOR EACH ROW
WHEN (old.box_id IS DISTINCT FROM new.box_id)
EXECUTE FUNCTION private.finance_cascade_installment_box();
