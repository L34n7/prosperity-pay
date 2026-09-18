alter table public.integration_webhook_deliveries
  alter column payment_id drop not null,
  add column if not exists subject_type text,
  add column if not exists subject_id text;

update public.integration_webhook_deliveries
set subject_type = coalesce(subject_type, 'payment'),
    subject_id = coalesce(subject_id, payment_id::text)
where subject_type is null or subject_id is null;

alter table public.integration_webhook_deliveries
  alter column subject_type set not null,
  alter column subject_id set not null;

create unique index if not exists integration_webhook_deliveries_subject_event_key
  on public.integration_webhook_deliveries (integration, subject_type, subject_id, event_type);

create index if not exists integration_webhook_deliveries_subject_idx
  on public.integration_webhook_deliveries (subject_type, subject_id, created_at desc);
