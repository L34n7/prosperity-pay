begin;

alter table public.payout_accounts
  add column if not exists holder_tax_id_encrypted text;

comment on column public.payout_accounts.holder_tax_id_encrypted is
  'AES-GCM encrypted holder CPF/CNPJ used for owner editing and administrative review.';

commit;