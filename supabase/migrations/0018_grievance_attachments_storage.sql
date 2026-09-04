-- UNI8 — Developer 3, Phase 8 (Central Grievance CRM)
-- 0018_grievance_attachments_storage.sql
--
-- Creates the PRIVATE `grievance-attachments` bucket that
-- lib/storage/buckets.ts has referenced by name since Phase 1 and that
-- grievance_attachments rows point into. This closes KNOWN_ISSUES #3, which
-- explicitly deferred the bucket to "Phase 8 (grievance attachments), reusing
-- the same is_super_admin() / is_active_vendor_admin_for() helper functions".
--
-- SRS §13 requires attachments to be "private and access-controlled", and the
-- Phase 8 completion standard requires that customer grievances be "visible
-- and actionable only to UNI8 support/Super Admins". Those two sentences
-- together decide the access model below.
--
-- Path convention: buildStoragePath("ticket", ticketId, filename) produces
--   ticket/<ticket-uuid>/<epoch>-<safe-name>
-- so (string_to_array(name,'/'))[2] is the ticket id — the same second-segment
-- trick 0015 uses for restaurant scoping.
--
-- Access model:
--   * Super Admin: full read/write. Support agents triage every ticket.
--   * Requester (customer OR vendor user who opened the ticket): may read and
--     upload on their OWN open ticket. Evidence is useless if the person
--     reporting the problem cannot attach a photo of the wrong item.
--   * Vendor Admins: NO access to attachments on a ticket they do not own,
--     even for their own restaurant. SRS §13/§7.2 keep customer grievance
--     content inside UNI8 support; a customer's screenshot may contain their
--     phone number, other orders, or complaints about the vendor themselves.
--   * The bucket is private, so a correct path is still unreadable without a
--     short-lived signed URL issued server-side after a guard check
--     (lib/data/admin-grievances.ts, lib/data/vendor-grievances.ts).
--
-- Note there is no DELETE policy for requesters. SRS §13 calls the ticket
-- timeline immutable; letting a requester delete evidence after the fact
-- would break that. Super Admin delete exists for genuine PII takedown
-- requests under §P, and is audited by the calling action.

insert into storage.buckets (id, name, public)
values ('grievance-attachments', 'grievance-attachments', false)
on conflict (id) do nothing;

create policy "grievance_attachments_read_scoped"
  on storage.objects for select
  using (
    bucket_id = 'grievance-attachments'
    and (
      is_super_admin()
      or exists (
        select 1
        from grievance_tickets t
        where t.id = ((string_to_array(name, '/'))[2])::uuid
          and t.requester_id = auth.uid()
      )
    )
  );

create policy "grievance_attachments_insert_scoped"
  on storage.objects for insert
  with check (
    bucket_id = 'grievance-attachments'
    and (
      is_super_admin()
      or exists (
        select 1
        from grievance_tickets t
        where t.id = ((string_to_array(name, '/'))[2])::uuid
          and t.requester_id = auth.uid()
          -- A closed ticket stops accepting new evidence; reopening (which
          -- sets status back to open/in_review) makes it writable again.
          and t.status not in ('resolved', 'closed')
      )
    )
  );

create policy "grievance_attachments_super_admin_update"
  on storage.objects for update
  using (bucket_id = 'grievance-attachments' and is_super_admin());

create policy "grievance_attachments_super_admin_delete"
  on storage.objects for delete
  using (bucket_id = 'grievance-attachments' and is_super_admin());
