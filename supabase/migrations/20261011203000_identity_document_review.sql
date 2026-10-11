begin;

alter table public.identity_verifications
  add column if not exists document_storage_path text,
  add column if not exists document_original_name text,
  add column if not exists document_mime_type text,
  add column if not exists document_uploaded_at timestamptz;

comment on column public.identity_verifications.document_storage_path is
  'Private Storage path for the identity document submitted for manual review.';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'identity-documents',
  'identity-documents',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

commit;