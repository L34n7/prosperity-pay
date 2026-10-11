begin;

alter table public.identity_verifications
  add column if not exists tax_id_encrypted text;

comment on column public.identity_verifications.tax_id_encrypted is
  'AES-GCM encrypted CPF/CNPJ used only for owner/admin review and resubmission.';

commit;