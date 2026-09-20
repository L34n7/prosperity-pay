-- Primeiro acesso do Prosperity Pay:
-- link proprio valido por 24 horas, no maximo 3 aberturas,
-- senha cadastrada uma unica vez e novo link invalida os anteriores.

create table if not exists public.first_access_tokens (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  openings integer not null default 0,
  max_openings integer not null default 3,
  last_opened_at timestamptz,
  password_set_at timestamptz,
  invalidated_at timestamptz,
  processing_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint first_access_tokens_openings_check
    check (
      openings >= 0
      and max_openings >= 1
      and max_openings <= 10
      and openings <= max_openings
    )
);

create index if not exists first_access_tokens_auth_user_idx
  on public.first_access_tokens(auth_user_id);

create index if not exists first_access_tokens_email_idx
  on public.first_access_tokens(lower(email));

create index if not exists first_access_tokens_expires_idx
  on public.first_access_tokens(expires_at);

alter table public.first_access_tokens enable row level security;
revoke all on public.first_access_tokens from public, anon, authenticated;
grant all on public.first_access_tokens to service_role;

create or replace function public.get_auth_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select u.id
  from auth.users as u
  where lower(u.email) = lower(trim(p_email))
    and u.deleted_at is null
  order by u.created_at asc
  limit 1;
$$;

create or replace function public.register_first_access_open(p_token_hash text)
returns table(
  ok boolean,
  reason text,
  email text,
  openings integer,
  max_openings integer,
  remaining_openings integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.first_access_tokens%rowtype;
begin
  select t.*
  into v_row
  from public.first_access_tokens as t
  where t.token_hash = p_token_hash
  for update;

  if not found then
    return query
    select false, 'invalid', null::text, 0, 3, 0, null::timestamptz;
    return;
  end if;

  if v_row.password_set_at is not null then
    return query
    select false, 'password_set', v_row.email, v_row.openings,
      v_row.max_openings,
      greatest(v_row.max_openings - v_row.openings, 0),
      v_row.expires_at;
    return;
  end if;

  if v_row.invalidated_at is not null then
    return query
    select false, 'invalidated', v_row.email, v_row.openings,
      v_row.max_openings,
      greatest(v_row.max_openings - v_row.openings, 0),
      v_row.expires_at;
    return;
  end if;

  if v_row.expires_at <= now() then
    return query
    select false, 'expired', v_row.email, v_row.openings,
      v_row.max_openings, 0, v_row.expires_at;
    return;
  end if;

  if v_row.openings >= v_row.max_openings then
    return query
    select false, 'opening_limit', v_row.email, v_row.openings,
      v_row.max_openings, 0, v_row.expires_at;
    return;
  end if;

  update public.first_access_tokens as t
  set openings = t.openings + 1,
      last_opened_at = now(),
      updated_at = now()
  where t.id = v_row.id
  returning t.* into v_row;

  return query
  select true, 'ok', v_row.email, v_row.openings, v_row.max_openings,
    greatest(v_row.max_openings - v_row.openings, 0),
    v_row.expires_at;
end;
$$;

create or replace function public.reserve_first_access_password(p_token_hash text)
returns table(
  ok boolean,
  reason text,
  auth_user_id uuid,
  email text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.first_access_tokens%rowtype;
begin
  select t.*
  into v_row
  from public.first_access_tokens as t
  where t.token_hash = p_token_hash
  for update;

  if not found then
    return query select false, 'invalid', null::uuid, null::text;
    return;
  end if;

  if v_row.password_set_at is not null then
    return query select false, 'password_set', v_row.auth_user_id, v_row.email;
    return;
  end if;

  if v_row.invalidated_at is not null then
    return query select false, 'invalidated', v_row.auth_user_id, v_row.email;
    return;
  end if;

  if v_row.expires_at <= now() then
    return query select false, 'expired', v_row.auth_user_id, v_row.email;
    return;
  end if;

  if v_row.openings < 1 or v_row.openings > v_row.max_openings then
    return query select false, 'open_required', v_row.auth_user_id, v_row.email;
    return;
  end if;

  if v_row.processing_at is not null
     and v_row.processing_at > now() - interval '5 minutes' then
    return query select false, 'processing', v_row.auth_user_id, v_row.email;
    return;
  end if;

  update public.first_access_tokens as t
  set processing_at = now(),
      updated_at = now()
  where t.id = v_row.id;

  return query select true, 'ok', v_row.auth_user_id, v_row.email;
end;
$$;

create or replace function public.complete_first_access_password(p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  update public.first_access_tokens as t
  set password_set_at = now(),
      processing_at = null,
      updated_at = now()
  where t.token_hash = p_token_hash
    and t.password_set_at is null
    and t.invalidated_at is null
    and t.processing_at is not null;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.release_first_access_password(p_token_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.first_access_tokens as t
  set processing_at = null,
      updated_at = now()
  where t.token_hash = p_token_hash
    and t.password_set_at is null;
$$;

revoke all on function public.get_auth_user_id_by_email(text)
  from public, anon, authenticated;
grant execute on function public.get_auth_user_id_by_email(text)
  to service_role;

revoke all on function public.register_first_access_open(text)
  from public, anon, authenticated;
grant execute on function public.register_first_access_open(text)
  to service_role;

revoke all on function public.reserve_first_access_password(text)
  from public, anon, authenticated;
grant execute on function public.reserve_first_access_password(text)
  to service_role;

revoke all on function public.complete_first_access_password(text)
  from public, anon, authenticated;
grant execute on function public.complete_first_access_password(text)
  to service_role;

revoke all on function public.release_first_access_password(text)
  from public, anon, authenticated;
grant execute on function public.release_first_access_password(text)
  to service_role;
