-- UNI8 — Phase 8B (Central grievance CRM, SRS §13 + V2 §I + V2.6 §59/§63)
-- 0022_phase8b_grievance_notifications.sql
--
-- Phase 8B needs no schema change: 0016 added ticket_no, the SLA columns,
-- escalation, reopen, closed_at, CSAT, `grievance_assignments` and
-- `grievance_templates`; 0017 gave them RLS; 0021 turned `notifications` into
-- the in-app object §63 describes. What is missing is COPY.
--
-- Two customer-facing support events reach a requester through the notification
-- centre and had no template, so `lib/notifications/in-app.ts` would have had to
-- fall back to hard-coded strings — which would put support wording outside the
-- operator's reach and contradict §Y ("notification copy is Super
-- Admin-editable"). Seeded here as `inapp` and active.
--
-- Additive and idempotent: `on conflict (key) do nothing`, so re-running this
-- against a database where an operator has already edited the copy leaves their
-- edit alone.

insert into notification_templates (key, channel, title, body, description, variables) values
  (
    'grievance_replied',
    'inapp',
    'Support replied',
    'UNI8 support replied to ticket #{{ticket_no}}. Open it to read the reply.',
    'SRS §13 support update: an agent posted a requester-visible reply. Internal notes never notify.',
    '["ticket_no"]'::jsonb
  ),
  (
    'grievance_opened',
    'inapp',
    'We have your ticket',
    'Ticket #{{ticket_no}} is open with UNI8 support. We will reply here.',
    'Acknowledgement for the V2 §I order-issue shortcut and the V2.6 §59 not-ready prompt, where the customer never typed a ticket reference and needs one to follow.',
    '["ticket_no"]'::jsonb
  )
on conflict (key) do nothing;

-- The §13 SLA policy needs no seed here: 0016 already wrote
-- admin_settings.grievance_sla_minutes with the same four priority bands that
-- lib/grievance/sla.ts falls back to, in that file's `first_response` /
-- `resolution` key shape. Re-seeding it with a second key spelling would give
-- the settings screen two rows to disagree over.

-- §13 ships with a starter set of approved response macros so the composer's
-- template picker is not empty on day one. Names are unique case-insensitively
-- (uq_grievance_templates_name); `on conflict do nothing` needs an inference
-- target it cannot use for a functional index, so each insert is guarded by a
-- not-exists instead.
insert into grievance_templates (name, category, body)
select v.name, v.category::grievance_category, v.body
from (values
  (
    'Acknowledge and investigating',
    null,
    'Thanks for raising this — we have it and we are looking into it now. We will come back to you here as soon as we have an answer from the restaurant.'
  ),
  (
    'Refund approved',
    'refund',
    'We have approved a refund for this order. It is processed back to your original payment method and typically appears within 5-7 working days depending on your bank. You will see a confirmation here once it completes.'
  ),
  (
    'Missing item — refund for the item',
    'missing_item',
    'Sorry about the missing item. We have raised a partial refund for it rather than asking you to go back to the counter. Nothing further is needed from you.'
  ),
  (
    'Order was not ready on time',
    'pickup',
    'Sorry you were kept waiting. We have flagged this with the restaurant. Your order is still valid and your QR still works — please collect it when it is handed over, and tell us here if it is not.'
  ),
  (
    'QR would not scan',
    'qr',
    'Thanks for telling us. Your QR is valid and the counter can collect the order manually against your ticket while we look at the scanner. Please show them this ticket number.'
  ),
  (
    'Need a little more detail',
    null,
    'We want to get this right — could you tell us a bit more? Anything specific about what was wrong, and roughly when you were at the counter, helps us check it against the restaurant record.'
  )
) as v(name, category, body)
where not exists (
  select 1 from grievance_templates t where lower(t.name) = lower(v.name)
);

comment on table grievance_templates is
  'SRS §13 approved response macros. Retired by is_active = false, never '
  'deleted: a retired template is still the wording that went out to requesters '
  'while it was live (§P).';
