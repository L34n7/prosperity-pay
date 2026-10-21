-- Keeps repository migration history aligned with the production migration
-- applied while reconciling CRM Prosperity VIP payment routing.
insert into public.integration_webhook_routes (
  integration,
  offer_reference,
  active,
  metadata
)
values
  (
    'crm_prosperity',
    '3c43f1e480b7',
    true,
    '{"plan_slug":"basico","purpose":"crm_subscription","offer_type":"vip"}'::jsonb
  ),
  (
    'crm_prosperity',
    '2ce9243c812e',
    true,
    '{"plan_slug":"basico","purpose":"crm_subscription","offer_type":"special"}'::jsonb
  )
on conflict (integration, offer_reference) do update
set active = excluded.active,
    metadata = excluded.metadata,
    updated_at = now();
