-- The old snapshot policy read financial_allocations, while its policy read
-- financial_snapshots. PostgreSQL expands both policies even for empty tables,
-- so a producer's dashboard failed with 42P17 before returning any rows.
drop policy if exists snapshots_select_related on public.financial_snapshots;

create policy snapshots_select_related on public.financial_snapshots
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = financial_snapshots.order_id
        and (o.producer_id = (select auth.uid()) or public.is_finance_admin())
    )
  );
