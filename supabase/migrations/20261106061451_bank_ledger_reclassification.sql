-- Conciliacao do extrato: movimentacoes efetivas do banco nao sao contas a pagar.
-- Reclassifica apenas extratos importados, mantendo os valores, horarios e IDs.
DO $$
DECLARE
  v_rows int;
  v_leandro uuid;
BEGIN
  SELECT id INTO STRICT v_leandro
  FROM public.finance_boxes
  WHERE name='Leandro'
    AND owner_user_id=(SELECT owner_user_id FROM public.finance_entries
      WHERE notes LIKE '%[EXTRACT-202610-INTER202610-03]%' LIMIT 1);

  -- Validar os registros exatos antes de atualizar; nenhuma outra conta sera alterada.
  IF (SELECT count(*) FROM public.finance_entries
      WHERE kind='expense' AND status='paid' AND card_id IS NULL
        AND notes LIKE '%[EXTRACT-202610-%') <> 25 THEN
    RAISE EXCEPTION 'Quantidade de saidas bancarias historicas diferente de 25; verificar manualmente';
  END IF;
  IF (SELECT count(*) FROM public.finance_entries WHERE
    (id='7ccf0a84-7831-4c73-8b10-393831ae0aea'::uuid AND
      title='Pix recebido Ministério Unido Casa de Deus' AND
      amount_cents=45000 AND kind='income') OR
    (id='5ab31cc8-0856-4b73-b84a-fef442966a09'::uuid AND
      title='Jefferson Eugênio - parte CRM' AND
      amount_cents=8334 AND kind='income')) <> 2 THEN
    RAISE EXCEPTION 'Recebimentos esperados alterados; interrompendo conciliacao';
  END IF;

  UPDATE public.finance_entries
     SET kind='outflow',due_on=NULL
   WHERE kind='expense' AND status='paid' AND card_id IS NULL
     AND notes LIKE '%[EXTRACT-202610-%';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows<>25 THEN RAISE EXCEPTION 'Esperadas 25 saidas bancarias, atualizadas %',v_rows; END IF;

  UPDATE public.finance_entries
     SET box_id=v_leandro,
       notes=concat(notes,' Classificacao do recebimento ajustada para caixa Leandro em 06/11/2026.')
   WHERE id='7ccf0a84-7831-4c73-8b10-393831ae0aea'::uuid
     AND title='Pix recebido Ministério Unido Casa de Deus';
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN RAISE EXCEPTION 'Ministerio Unido nao encontrado';END IF;

  UPDATE public.finance_entries
     SET box_id=v_leandro,
         title='Jefferson Eugênio - parte Leandro',
         notes=replace(notes,'R$83,34 pertencem ao CRM','R$83,34 pertencem a Leandro') ||
           ' Classificacao corrigida em 06/11/2026.'
   WHERE id='5ab31cc8-0856-4b73-b84a-fef442966a09'::uuid
     AND title='Jefferson Eugênio - parte CRM';
  GET DIAGNOSTICS v_rows=ROW_COUNT;
  IF v_rows<>1 THEN RAISE EXCEPTION 'Jefferson nao encontrado';END IF;
END $$;
