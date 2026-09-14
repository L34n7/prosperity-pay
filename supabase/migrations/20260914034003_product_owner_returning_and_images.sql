-- RETURNING evaluates SELECT RLS in the same command as the INSERT. The
-- participates_in_product() lookup cannot see the just-inserted product yet.
create policy products_select_owner on public.products
  for select to authenticated
  using (producer_id = (select auth.uid()));

alter table public.products add column image_path text;
alter table public.products add constraint products_image_path_owner_check
  check (
    image_path is null or (
      split_part(image_path, '/', 1) = producer_id::text
      and split_part(image_path, '/', 2) = id::text
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images', 'product-images', true, 3145728,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
);

create policy product_images_insert_owner on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.products p
      where p.id::text = (storage.foldername(name))[2]
        and p.producer_id = (select auth.uid())
    )
  );

create policy product_images_select_owner on storage.objects
  for select to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy product_images_delete_owner on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
