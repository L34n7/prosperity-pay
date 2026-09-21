-- Transfer all Prosperity Pay product ownership from the platform admin's
-- personal account to the CRM Prosperity producer account.
--
-- Product IDs, slugs, offer IDs, checkout slugs, webhook references and
-- historical financial records are intentionally preserved.

do $$
declare
  v_source uuid;
  v_target uuid;
  v_count integer;
begin
  select id into v_source
  from public.profiles
  where lower(email) = 'leandroisis100@gmail.com'
  limit 1;

  select id into v_target
  from public.profiles
  where lower(email) = 'crmprosperity@gmail.com'
  limit 1;

  if v_source is null then
    raise exception 'Conta de origem leandroisis100@gmail.com nao encontrada';
  end if;

  if v_target is null then
    raise exception 'Conta de destino crmprosperity@gmail.com nao encontrada';
  end if;

  update public.products
  set producer_id = v_target,
      updated_at = now()
  where producer_id = v_source;

  get diagnostics v_count = row_count;

  if v_count <> 3 then
    raise exception
      'Transferencia abortada: esperado transferir 3 produtos, mas foram encontrados %',
      v_count;
  end if;
end
$$;

-- Orders and financial allocations created before this transfer deliberately
-- keep their original producer_id / beneficiary_user_id. This preserves the
-- historical financial snapshot and audit trail. New orders inherit the new
-- owner through products.producer_id.
