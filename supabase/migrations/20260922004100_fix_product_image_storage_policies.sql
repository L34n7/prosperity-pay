drop policy if exists product_images_insert_owner on storage.objects;
drop policy if exists product_images_select_owner on storage.objects;
drop policy if exists product_images_delete_owner on storage.objects;

create policy product_images_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and split_part(storage.objects.name, '/', 1) = (select auth.uid())::text
    and exists (
      select 1
      from public.products product
      where product.id::text = split_part(storage.objects.name, '/', 2)
        and product.producer_id = (select auth.uid())
    )
  );

create policy product_images_select_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-images'
    and split_part(storage.objects.name, '/', 1) = (select auth.uid())::text
  );

create policy product_images_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and split_part(storage.objects.name, '/', 1) = (select auth.uid())::text
  );
