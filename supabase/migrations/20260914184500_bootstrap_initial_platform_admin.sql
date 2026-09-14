begin;

create or replace function public.bootstrap_initial_platform_admin()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  first_user_id uuid;
begin
  if current_user_id is null then
    return false;
  end if;

  if exists (
    select 1
    from public.user_roles
    where user_id = current_user_id
      and role = 'admin'
  ) then
    return true;
  end if;

  if exists (
    select 1
    from public.user_roles
    where role = 'admin'
  ) then
    return false;
  end if;

  select id
    into first_user_id
  from public.profiles
  order by created_at asc, id asc
  limit 1;

  if first_user_id is distinct from current_user_id then
    return false;
  end if;

  insert into public.user_roles(user_id, role, granted_by)
  values (current_user_id, 'admin', current_user_id)
  on conflict (user_id, role) do nothing;

  insert into public.audit_events(actor_user_id, action, entity_type, entity_id, metadata)
  values (
    current_user_id,
    'platform_admin.bootstrap',
    'user_role',
    current_user_id,
    jsonb_build_object('role', 'admin', 'reason', 'initial_platform_owner')
  );

  return exists (
    select 1
    from public.user_roles
    where user_id = current_user_id
      and role = 'admin'
  );
end;
$$;

revoke all on function public.bootstrap_initial_platform_admin() from public, anon;
grant execute on function public.bootstrap_initial_platform_admin() to authenticated;

commit;
