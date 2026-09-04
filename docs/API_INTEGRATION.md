# API / Integration Documentation

Current through Phase 8B. UNI8's "API" is almost entirely Next.js Server Actions
(called directly from React components, not over a public REST surface) — see
`docs/ARCHITECTURE.md` for why. The genuine HTTP endpoints are listed below.

## Route Handlers (real HTTP endpoints)

| Route | Method | Purpose | Auth |
|---|---|---|---|
| `/api/webhooks/razorpay` | POST | Razorpay payment webhook | Verified via `X-Razorpay-Signature`, not a user session — see `docs/PAYMENTS.md` |
| `/admin/orders/export` | GET | Global order CSV | `requireSuperAdmin()` inside the handler |
| `/admin/customers/export` | GET | Customer directory CSV | `requireSuperAdmin()` inside the handler |
| `/admin/grievances/export` | GET | Grievance queue CSV (deliberately excludes message bodies) | `requireSuperAdmin()` inside the handler |

The three export handlers take the same query parameters as their list pages, so
the file matches the filtered view the operator was looking at. **Each guards
itself.** They are reachable by URL without any layout rendering, so the route
group's `requireRole()` is not protecting them — a point worth remembering
before adding a fourth.

No other Route Handlers exist. Three scheduled jobs are specified and unbuilt
(abandoned-checkout cleanup, orphaned-attachment sweep, SLA digests);
`INTERNAL_CRON_SECRET` in `.env.example` is reserved for whichever endpoint
shape they end up taking. See `docs/DEPLOYMENT.md` "Scheduled jobs".

## Server Actions (the actual "API" surface)

Organized by `lib/actions/<domain>/`. Every one independently re-checks
authorization via `lib/auth/guards.ts` — see `docs/AUTH_RBAC.md` — and none of
them trust client-submitted prices, totals, restaurant IDs, storage paths, or
pickup times without re-deriving/re-validating server-side (SRS §17). Every
input is parsed by a zod schema before anything else happens.

### `lib/actions/customer/`
| Module | Actions |
|---|---|
| `cart.ts` | `addToCart`, `updateCartItemQuantity`, `removeCartItem`, `getCurrentCartGrouped` — price/availability always re-read fresh |
| `schedule.ts` | `confirmPickupSchedule` — validates and persists a multi-restaurant pickup sequence |
| `checkout-preview.ts` | `getCheckoutPreview` — re-validates everything, returns preview or issues |
| `checkout.ts` | `initiateRazorpayCheckout` — creates `payment_pending` orders + the Razorpay order |
| `verify-payment.ts` | `verifyPaymentAndGetOrders` — fast-path confirmation (see `docs/PAYMENTS.md`) |
| `rating.ts` | `submitRating` — 1–5 stars, only on a `collected` order, once |
| `grievance.ts` | `createOrderIssueTicket`, `postCustomerGrievanceMessage`, `reopenCustomerGrievance`, `submitGrievanceCsat` — each re-checks `requester_id` **and** `requester_role` against the caller |

### `lib/actions/restaurant/` (staff + vendor admin, restaurant-scoped)
| Module | Actions |
|---|---|
| `scan.ts` | `submitScan`, `searchCollectibleOrdersByPhone`, `submitFallbackCollection` (SRS V2 §K) |
| `order-status.ts` | `startPreparing`, `markReady`, `markNoShow`, `cancelOrderByRestaurant` — all via `transitionOrder()` |

### `lib/actions/vendor/`
| Module | Actions |
|---|---|
| `products.ts` | `createCategory`, `renameCategory`, `createProduct`, `updateProduct`, `setProductAvailability`, `archiveProduct`, `restoreProduct`, `setProductVisibility`, `setCategoryVisibility`, `reorderProducts`, `reorderCategories` |
| `restaurant-settings.ts` | `updateRestaurantOperations`, `pauseRestaurant`, `unpauseRestaurant`, `setRestaurantHours`, `addHourException`, `removeHourException`, `setCapacityOverride`, `removeCapacityOverride` |
| `staff.ts` | `createStaffMember`, `deactivateStaffMember`, `reactivateStaffMember`, `resetStaffCredential` — the last two also call `force_logout_user()` |
| `acknowledge-payout.ts` | `markPayoutReceived`, `markPayoutNotReceived` |
| `grievance.ts` | `createVendorGrievance`, `postVendorGrievanceMessage` |

### `lib/actions/admin/` (all `requireSuperAdmin()` + `recordAuditEvent()`)
| Module | Actions |
|---|---|
| `restaurants.ts` | `createRestaurant`, `updateRestaurantClassification`, `setRestaurantStatus` (the four V2.6 §60 states), `updateRestaurantOperations` |
| `restaurant-access.ts` | `grantRestaurantAccess`, `revokeRestaurantAccess`, `setProfileStatus` |
| `restaurant-catalog.ts` | `setProductVisibility`, `setCategoryVisibility`, `reorderCatalog` |
| `restaurant-pickup.ts` | `setRestaurantDayHours`, `upsertHourException`, `deleteHourException`, `upsertCapacityOverride`, `deleteCapacityOverride` |
| `walking-times.ts` | `setWalkingTime`, `setWalkingTimeBothWays`, `clearWalkingTime` |
| `update-commission-rate.ts` | `updateCommissionRate` — changes the setting only; never rewrites a snapshot |
| `disburse.ts` | `disburseToVendor` |
| `refund.ts` | `recordManualRefund` — an additive ledger row, never an edit to the sale |
| `live-ops.ts` | `acknowledgeAlert`, `clearAlertAcknowledgement` |
| `customers.ts` | `addCustomerNote`, `addCustomerFlag`, `clearCustomerFlag`, `setCustomerAccountStatus` |
| `grievance.ts` | `postAdminGrievanceMessage`, `setGrievanceStatus`, `assignGrievance`, `setGrievancePriority`, `escalateGrievance`, `reopenGrievance`, `createGrievanceTemplate`, `setGrievanceTemplateActive`, `linkGrievanceRecords` |

Note the two `setProductVisibility` implementations — one vendor-scoped, one
super-admin. They are deliberately separate functions with separate guards
rather than one function with a role branch, because a role branch is one edit
away from being wrong in the vendor's favour.

## Direct browser→Supabase calls

Two paths bypass Server Actions on purpose, and in both the Storage RLS policy
*is* the authorization check rather than a convenience:

- **Product/branding image upload** (vendor) → `product-images`,
  `restaurant-branding`.
- **Grievance attachment upload** (customer or support) →
  `grievance-attachments`, under `ticket/<ticket-id>/`. A guarded Server Action
  then writes the `grievance_attachments` row after `parseAttachmentPaths()`
  proves the path is in scope. See `docs/ARCHITECTURE.md` "Storage".

Reads of private buckets never happen from the browser — the server issues a
300-second signed URL per render.

## Third-party integrations

| Service | Used for | Docs |
|---|---|---|
| Supabase (Postgres, Auth, Storage) | Everything — see `docs/ARCHITECTURE.md` | supabase.com/docs |
| Razorpay | Customer payment collection | See `docs/PAYMENTS.md` |
| SMS provider | Not yet selected — abstraction only (`lib/notifications/sms/`) | SRS §Y |

## Webhook behavior contract

`POST /api/webhooks/razorpay` always returns `200 {"received": true}` for
any request with a valid signature, REGARDLESS of whether the underlying
event was successfully processed into confirmed orders — see
`docs/PAYMENTS.md`'s exception-handling table for why (most failure modes
here are permanent, not something a Razorpay retry would fix, so we
don't want to trigger their 24-hour retry storm for them). The one case
that returns non-2xx is a genuinely transient failure (e.g. a network
error calling Razorpay's own API from inside `finalizePayment`), which
SHOULD be retried — that happens naturally because an unhandled throw in
a Next.js Route Handler produces a 500.

Invalid/missing signature returns `400`. Missing event ID returns `400`.
Server misconfiguration (missing secret) returns `500`.
