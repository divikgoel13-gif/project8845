-- UNI8 — Developer 3, Phases 7-9 (SRS V2.6 additions)
-- 0021_v26_schema.sql
--
-- The V2.6 addendum (cumulative over V2.5) assigns three schema-bearing
-- requirements to Developer 3's phases that no earlier migration could have
-- anticipated, because V2.6 postdates the Phase 1 schema:
--
--   1. §29 / §33 — "Every restaurant must be explicitly classified by Super
--      Admin as Inside University or Outside University", with a
--      database-backed University Place Name that "must never be hardcoded in
--      the frontend". Allocated to "Developer 3 / Super Admin
--      restaurant-management scope" by the §32 ownership table, and named again
--      in §54 as Phase 7 work.
--
--   2. §60 — "Product active/archived, visibility and stock/availability are
--      distinct concepts where required" and "Vendor Admin/Super Admin can
--      control product display order within categories". Phase 1 gave products
--      `archived_at`, `availability` and `sort_order`, but no visibility flag,
--      so "hidden from the menu" and "out of stock" were the same state.
--
--   3. §63 — "V1 uses in-app notifications only... Notifications are stored
--      server-side with user/order/ticket/event linkage and persistent
--      read/unread state." The Phase 1 `notifications` table was designed for
--      SMS dispatch receipts: it has no read state and no linkage.
--
-- The 'closed' restaurant status and the restaurant_location_type enum are added
-- in 0020, which exists solely because a new enum label cannot be used in the
-- same transaction that adds it.
--
-- As with 0016, every change here is a new nullable column, a new column with a
-- safe default, or a new table — nothing rewrites an existing financial, order
-- or audit record, so this is safe to apply to live Phase 1-6 data.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. UNIVERSITY-INTERNAL RESTAURANT CLASSIFICATION (SRS V2.6 §29, Phase 7)
-- ─────────────────────────────────────────────────────────────────────────

alter table restaurants
  -- §29.1 calls the dropdown "required". It is modelled as NOT NULL with a
  -- default of 'outside_university' rather than a nullable column, because a
  -- null would mean "unclassified" and §29.2 keys a mandatory customer-facing
  -- access warning off this value — a null would silently suppress that
  -- warning. Defaulting to the SAFE side (outside = no access restriction
  -- claimed) means an unclassified legacy row shows no warning it cannot
  -- justify, and the Super Admin restaurant form forces an explicit choice.
  add column if not exists location_type restaurant_location_type not null
    default 'outside_university',

  -- §29.1: "If Inside University is selected, Super Admin must configure a
  -- University Place Name, such as the campus building, food court or other
  -- access-controlled place." Nullable, because it is meaningless for an
  -- outside-university restaurant; the pairing is enforced by the check below.
  add column if not exists university_place_name text,

  -- §60 adds 'Closed' alongside 'Paused'. Paused is the short operational
  -- breather from §G (timed or manual reopen); Closed is an indefinite
  -- not-trading state that is still not an archive. Both block new orders and
  -- neither touches existing paid orders, so they need the same reason/actor
  -- provenance the pause columns already have.
  add column if not exists closed_at timestamptz,
  add column if not exists closed_reason text,
  add column if not exists status_changed_at timestamptz,
  add column if not exists status_changed_by uuid references profiles (id);

comment on column restaurants.location_type is
  'SRS V2.6 §29: Inside University restaurants trigger the mandatory customer '
  'access-awareness popup before ordering. Changes are audit logged (§29.1).';

comment on column restaurants.university_place_name is
  'SRS V2.6 §29.1: the access-controlled place (building / food court). '
  'Database-backed by requirement — must never be hardcoded in the frontend, '
  'because the popup copy interpolates it: "You can only order from [PLACE '
  'NAME] if you are a valid student/faculty/staff member...".';

-- The pairing rule from §29.1, enforced in the database rather than only in the
-- Server Action: an inside-university restaurant without a place name would
-- render a popup reading "You can only order from  if you are...". Written as
-- NOT VALID so the constraint applies to all future writes without failing the
-- migration on a pre-existing row; every existing row defaults to
-- 'outside_university' and therefore satisfies it anyway, but NOT VALID keeps
-- the migration non-blocking on a large table.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'restaurants_university_place_name_check'
  ) then
    alter table restaurants
      add constraint restaurants_university_place_name_check check (
        location_type <> 'inside_university'
        or (university_place_name is not null and length(btrim(university_place_name)) > 0)
      ) not valid;
  end if;
end
$$;

-- §29.2's popup is only shown for inside-university restaurants, and the
-- customer restaurant page reads the classification on every visit.
create index if not exists idx_restaurants_location_type
  on restaurants (location_type)
  where location_type = 'inside_university';

comment on index idx_restaurants_location_type is
  'Serves the customer restaurant page''s §29.2 popup decision.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. PRODUCT & CATEGORY VISIBILITY (SRS V2.6 §60, Phase 7)
-- ─────────────────────────────────────────────────────────────────────────

-- §60: "Product active/archived, visibility and stock/availability are distinct
-- concepts." The three now map to three columns with genuinely different
-- meanings, and the Phase 7 Menus screens present them separately:
--
--   archived_at   -- the product no longer exists in the catalogue, but
--                    historical order_items keep their own name/price snapshot
--                    (§60: "must not be hard-deleted in a way that breaks
--                    history").
--   is_visible    -- the product exists and may be in stock, but is not shown
--                    on the customer menu right now (seasonal item, a dish
--                    being repriced, a category being reorganised).
--   availability  -- the product is shown, but cannot be bought today.
--
-- Collapsing "hidden" into "out of stock" is what the requirement rules out: an
-- out-of-stock product still communicates that the restaurant sells it.
alter table products
  add column if not exists is_visible boolean not null default true;

alter table product_categories
  add column if not exists is_visible boolean not null default true,
  -- Categories were created without provenance columns; the Phase 7 Menus
  -- screen edits them, and §60 requires ordering to be deterministic and
  -- persistent, so the edit needs somewhere to record itself.
  add column if not exists updated_at timestamptz not null default now();

comment on column products.is_visible is
  'SRS V2.6 §60: menu visibility, distinct from availability (buyable today) '
  'and archived_at (removed from the catalogue).';

-- §60: "Category/product ordering is deterministic and persists." sort_order
-- alone is not deterministic — two products sharing a sort_order come back in
-- whatever order the planner chooses. Every menu read must therefore order by
-- (sort_order, name), and this index is what makes that cheap.
create index if not exists idx_products_menu_order
  on products (restaurant_id, category_id, sort_order, name)
  where archived_at is null;

create index if not exists idx_product_categories_order
  on product_categories (restaurant_id, sort_order, name);

comment on index idx_products_menu_order is
  'SRS V2.6 §60 deterministic menu ordering: order by (sort_order, name), never '
  'sort_order alone.';

-- product_categories now carries updated_at, so it needs the same trigger every
-- other updated_at table has. Without it the column would record insert time
-- forever and the Menus screen's "last edited" would be a lie.
drop trigger if exists trg_product_categories_updated_at on product_categories;
create trigger trg_product_categories_updated_at
  before update on product_categories
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────
-- 3. IN-APP NOTIFICATIONS (SRS V2.6 §63, Phase 9)
-- ─────────────────────────────────────────────────────────────────────────

-- §63 changes the V1 notification layer from SMS to in-app. The Phase 1 table
-- was a dispatch log — one row per SMS attempt, with a provider message id and
-- no notion of a recipient having seen it. An in-app notification is a
-- different object: it is READ by the recipient, it LINKS to the thing it is
-- about, and it must render without re-deriving copy from a template id.
--
-- The existing rows and the `channel` column are kept, not dropped: §70
-- ("Non-Removal Rule") allows retaining the earlier implementation as history,
-- and the SMS rows are a genuine record of what was sent during Phases 3-6.
alter table notifications
  -- Persistent read/unread state (§63). Nullable timestamptz rather than a
  -- boolean so the notification centre can show WHEN it was read and so
  -- "mark all as read" is a single audited-shaped write.
  add column if not exists read_at timestamptz,

  -- "user/order/ticket/event linkage" (§63). Denormalised foreign keys rather
  -- than digging them out of `payload`, because the notification centre needs
  -- to render a link for every row and RLS needs to reason about scope.
  -- on delete set null (not cascade): deleting the notification history of a
  -- refunded order would contradict §P.
  add column if not exists order_id uuid references orders (id) on delete set null,
  add column if not exists grievance_ticket_id uuid references grievance_tickets (id) on delete set null,
  add column if not exists restaurant_id uuid references restaurants (id) on delete set null,

  -- Rendered copy, resolved at send time from notification_templates. Stored on
  -- the row for the same reason order_items stores name_snapshot: an operator
  -- editing a template must not rewrite the wording of notifications already
  -- delivered to customers.
  add column if not exists title text,
  add column if not exists body text,

  -- Where the notification points. A path, never an absolute URL, so it cannot
  -- be turned into an off-site redirect if a payload is ever attacker-influenced.
  add column if not exists link_path text;

comment on column notifications.read_at is
  'SRS V2.6 §63 persistent read/unread state. Null means unread.';

comment on column notifications.body is
  'Copy rendered from notification_templates at SEND time and snapshotted here, '
  'so editing a template never rewrites notifications already delivered.';

-- A relative path only. Blocks '//evil.example' (protocol-relative) as well as
-- 'https://...', since the notification centre renders this straight into href.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_link_path_check'
  ) then
    alter table notifications
      add constraint notifications_link_path_check check (
        link_path is null
        or (link_path like '/%' and link_path not like '//%')
      ) not valid;
  end if;
end
$$;

-- The notification bell's only two queries: this user's unread count, and this
-- user's most recent notifications.
create index if not exists idx_notifications_user_unread
  on notifications (user_id, created_at desc)
  where read_at is null;

create index if not exists idx_notifications_user_recent
  on notifications (user_id, created_at desc);

comment on index idx_notifications_user_unread is
  'Unread badge count for the §63 in-app notification centre.';

-- §63: "Role and restaurant scoping applies to notifications." Phase 1 (0006)
-- already gave this table `notifications_select_own` — a recipient, or a super
-- admin, may read a row — because even a dispatch log is the recipient's data.
-- What in-app delivery adds is the read RECEIPT: the recipient must be able to
-- write back the fact that they have seen it. Insert deliberately still has no
-- policy, so a client cannot fabricate a notification; that is the same posture
-- as audit_logs and sms_provider_events.
--
-- The select policy is re-created here only if 0006 has not been applied (a
-- database built from a partial history), so this file is safe standalone.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'notifications' and policyname = 'notifications_select_own'
  ) then
    create policy "notifications_select_own" on notifications
      for select using (user_id = auth.uid() or is_super_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where tablename = 'notifications' and policyname = 'notifications_update_own_read_state'
  ) then
    -- Scoped to the recipient's own rows. Column-level restriction to read_at is
    -- not expressible in a policy, so the update path goes through a Server
    -- Action; this policy exists so that action works under the caller's
    -- identity rather than needing the service-role client for a read receipt.
    create policy "notifications_update_own_read_state" on notifications
      for update using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. NOTIFICATION TEMPLATES BECOME IN-APP (SRS V2.6 §63)
-- ─────────────────────────────────────────────────────────────────────────

-- The 0016 seed wrote five of its six templates as channel 'sms', which was
-- correct against V2 §E.2 and is superseded by V2.6 §63 ("SMS notification
-- delivery is not part of the current V1 notification layer"). Re-channelled
-- by key rather than re-seeded, so that any operator edit to `body` or `title`
-- made through /admin/settings between 0016 and now survives; a blanket
-- `where channel = 'sms'` would also capture templates an operator has since
-- added for a deliberate SMS purpose.
update notification_templates
  set channel = 'inapp',
      updated_at = now()
  where channel = 'sms'
    and key in (
      'order_paid', 'order_ready', 'pickup_reminder',
      'order_cancelled_by_restaurant', 'refund_processed'
    );

-- The SMS body copy opened with "UNI8: " because an SMS arrives with no
-- surrounding context. In-app copy renders inside the UNI8 notification
-- centre, where that prefix is noise.
update notification_templates
  set body = regexp_replace(body, '^UNI8:\s*', ''),
      updated_at = now()
  where channel = 'inapp' and body like 'UNI8:%';

-- Two events §63 names for customers that had no template, because they had no
-- SMS equivalent worth paying for.
insert into notification_templates (key, channel, title, body, description, variables) values
  (
    'order_collected',
    'inapp',
    'Order collected',
    'Your order at {{restaurant}} was collected. Thanks for using UNI8.',
    'SRS V2.6 §63 customer event: successful QR collection.',
    '["restaurant"]'::jsonb
  ),
  (
    'order_no_show',
    'inapp',
    'Pickup window expired',
    'The pickup window for your order at {{restaurant}} has expired. Raise a ticket if you believe this is wrong.',
    'SRS V2.6 §63 customer event: order marked no_show after the grace period.',
    '["restaurant"]'::jsonb
  ),
  (
    'grievance_resolved',
    'inapp',
    'Support ticket resolved',
    'Ticket #{{ticket_no}} has been resolved. Open it to read the resolution or reopen it.',
    'SRS V2.6 §63 support update; §13 reopen path.',
    '["ticket_no"]'::jsonb
  )
on conflict (key) do nothing;

-- SMS-era rows keep their DLT registration ids and stay in the table as
-- history, but must not be picked up by the in-app sender. Anything still on
-- channel 'sms' after the re-channelling above is deactivated rather than
-- deleted (§70 non-removal).
update notification_templates
  set is_active = false, updated_at = now()
  where channel = 'sms' and is_active;

comment on table notification_templates is
  'Super Admin-editable notification copy (SRS §Y, V2.6 §63). channel=''inapp'' '
  'is the V1 delivery layer; channel=''sms'' rows are retained history from the '
  'V2 §E.2 SMS design and are held inactive, not deleted (§70).';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RETENTION REGISTER CORRECTION FOR NOTIFICATIONS (SRS §P)
-- ─────────────────────────────────────────────────────────────────────────

-- The 0016 register wrote `('notifications', '1 year', 'delete')`, which was
-- right when the table was an SMS dispatch log whose provider-side detail lived
-- in sms_provider_events. Under §63 the same table holds what a USER was told
-- and when, so deleting it destroys the answer to "nobody told me the order was
-- cancelled". Updated in place rather than inserted as a second domain, because
-- two register rows describing one table is exactly the drift the register
-- exists to prevent.
update data_retention_policies
  set retention_period = '24 months',
      disposition = 'archive',
      rationale =
        'SRS V2.6 §63: in-app notifications are the evidence of what a user was '
        'told and when, not a dispatch log. Retained to answer customer '
        'disputes and archived rather than deleted so support history stays '
        'reconstructable (§P). Provider-side SMS detail remains in '
        'sms_provider_events under its own policy.',
      updated_at = now()
  where domain = 'notifications';
