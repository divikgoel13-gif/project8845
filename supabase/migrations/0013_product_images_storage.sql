-- UNI8 — Developer 2, Phase 4 (Vendor Admin Operations)
-- 0013_product_images_storage.sql
--
-- Creates the `product-images` bucket that lib/storage/buckets.ts has
-- referenced by name since Phase 1 (SRS §3: "Storage structure for
-- product images... Sensitive buckets private"), but which docs/ARCHITECTURE.md
-- notes is created via dashboard/CLI, not raw SQL — this migration does
-- that creation for real now that a live project exists, using the
-- equally-valid path of inserting directly into storage.buckets (what the
-- dashboard/CLI do under the hood), so the bucket's existence is captured
-- in migration history like everything else rather than being a manual,
-- undocumented one-off click.
--
-- Public bucket (product photos are shown to customers pre-auth, same as
-- the menu itself) — but WRITES are restricted to an active vendor_admin
-- for the restaurant_id encoded as the first path segment, matching the
-- lib/storage/buckets.ts#buildStoragePath convention
-- ("restaurant/<id>/<timestamp>-<filename>").

insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "product_images_public_read"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "product_images_vendor_write"
  on storage.objects for insert
  with check (
    bucket_id = 'product-images'
    and is_active_vendor_admin_for(((string_to_array(name, '/'))[2])::uuid)
  );

create policy "product_images_vendor_update"
  on storage.objects for update
  using (
    bucket_id = 'product-images'
    and is_active_vendor_admin_for(((string_to_array(name, '/'))[2])::uuid)
  );

create policy "product_images_vendor_delete"
  on storage.objects for delete
  using (
    bucket_id = 'product-images'
    and is_active_vendor_admin_for(((string_to_array(name, '/'))[2])::uuid)
  );
