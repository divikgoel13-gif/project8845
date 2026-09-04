-- UNI8 — Developer 3, Phase 6 (Payments, Manual Disbursement & Vendor Grievances)
-- 0015_payout_proofs_storage.sql
--
-- Creates the PRIVATE `payout-proofs` bucket that lib/storage/buckets.ts has
-- referenced by name since Phase 1 (SRS §3: "Storage structure for... payout
-- proofs. Sensitive buckets private."), and which the Phase 6 completion
-- standard "Proof upload/access is secure" depends on. Mirrors the mechanism
-- of 0013_product_images_storage.sql (insert into storage.buckets + explicit
-- storage.objects RLS) so the bucket's existence is captured in migration
-- history rather than being an undocumented dashboard click — but PRIVATE
-- (public = false), because a manual-disbursement proof (bank transfer
-- screenshot, UTR reference) is sensitive financial evidence, not a
-- customer-facing asset like a product photo.
--
-- Access model:
--   * Only Super Admin may WRITE (upload/update/delete) a proof — disbursement
--     is a Super Admin action (SRS §12; Phase 6: "Manual disbursement queue in
--     Super Admin"). In practice writes go through the service-role client in
--     lib/actions/admin/disburse.ts, but the policy is defense-in-depth so an
--     anon/authenticated key can never write here even if misused.
--   * READ is scoped to Super Admin (all) OR the active Vendor Admin of the
--     restaurant encoded as the path's second segment ("restaurant/<id>/...",
--     matching lib/storage/buckets.ts#buildStoragePath) — this is what backs
--     the Phase 6 deliverable "Vendor proof viewing" without exposing one
--     restaurant's payout evidence to another (SRS §4 restaurant scoping).
--   * The bucket is private, so even a correct object path is unreadable
--     without a signed URL; the app issues short-lived signed URLs
--     server-side after re-checking scope (see lib/data/vendor-payments.ts
--     and lib/data/admin-payments.ts).

insert into storage.buckets (id, name, public)
values ('payout-proofs', 'payout-proofs', false)
on conflict (id) do nothing;

create policy "payout_proofs_read_scoped"
  on storage.objects for select
  using (
    bucket_id = 'payout-proofs'
    and (
      is_super_admin()
      or is_active_vendor_admin_for(((string_to_array(name, '/'))[2])::uuid)
    )
  );

create policy "payout_proofs_super_admin_write"
  on storage.objects for insert
  with check (bucket_id = 'payout-proofs' and is_super_admin());

create policy "payout_proofs_super_admin_update"
  on storage.objects for update
  using (bucket_id = 'payout-proofs' and is_super_admin());

create policy "payout_proofs_super_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'payout-proofs' and is_super_admin());
