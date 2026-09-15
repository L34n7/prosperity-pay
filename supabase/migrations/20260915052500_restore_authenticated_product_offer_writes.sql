begin;

-- Product/offer mutations are performed with the authenticated user's Supabase client.
-- RLS already restricts these writes to the product owner, so the table-level
-- privileges must allow the request to reach those policies.
grant insert, update on public.products to authenticated;
grant insert, update on public.offers to authenticated;

commit;
