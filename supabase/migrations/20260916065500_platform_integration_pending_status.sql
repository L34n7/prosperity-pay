alter table public.platform_integrations
  drop constraint if exists platform_integrations_status_check;

alter table public.platform_integrations
  add constraint platform_integrations_status_check
  check (status in ('pending','active','disconnected'));
