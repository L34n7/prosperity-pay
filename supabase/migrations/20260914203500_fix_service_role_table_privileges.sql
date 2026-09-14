begin;

-- Server-side administrative clients use the Supabase service_role key.
-- Keep RLS enabled for application roles, but grant the trusted backend role
-- the table privileges it needs to read and manage platform data.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

-- Ensure tables/sequences created by future migrations inherit the same
-- backend privileges automatically.
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public
  grant usage, select on sequences to service_role;

commit;
