# Payments — Razorpay Integration (SRS §12, Phase 3)

**Status: implemented, UNVERIFIED against a live Razorpay account.** This
environment has no network access — nothing here has been run against a
real (even test-mode) Razorpay checkout. Every API call shape was
confirmed against Razorpay's current documentation via web search on
2026-08-27 (not from training-data memory alone — see citations in
`lib/payments/razorpay.ts`'s doc comment), but "matches the docs" and
"actually works" are different claims. **First integration task: run one
real test-mode payment through this code end-to-end and compare every
step against the Razorpay Dashboard's event log.**

## Flow overview

```
1. Customer confirms pickup schedule (Phase 2)
        │
2. Customer clicks "Continue to payment"
        ▼
3. initiateRazorpayCheckout(groupId)          [lib/actions/customer/checkout.ts]
   - Re-validates checkout preview (stale-cart protection, SRS V2 §L)
   - Creates `orders` rows, status = payment_pending, with order_items
     snapshot (price/name locked NOW)
   - Commission snapshotted onto each order NOW (SRS §11.5)
   - Creates a Razorpay Order (capture: "automatic")
   - Creates a `payments` row, status = created
        ▼
4. Browser opens Razorpay Checkout.js widget   [components/customer/razorpay-checkout-button.tsx]
        ▼
5a. Checkout succeeds in browser               5b. Razorpay sends a webhook
    → verifyPaymentAndGetOrders()                  → POST /api/webhooks/razorpay
      [lib/actions/customer/verify-payment.ts]      [app/api/webhooks/razorpay/route.ts]
    → verifies Checkout's signature               → verifies X-Razorpay-Signature
    → calls finalizePayment()                      → calls finalizePayment()
        │                                               │
        └───────────────────┬───────────────────────────┘
                             ▼
6. finalizePayment()                          [lib/orders/finalize-payment.ts]
   - THE ONE function both paths funnel through
   - Re-fetches payment from Razorpay's API (never trusts either caller's payload)
   - Verifies amount + order_id match our records
   - Captures payment if still "authorized" (defensive — auto-capture should
     have already done this)
   - Idempotent: safe to call twice for the same payment (see below)
   - Transitions payment_pending → paid → scheduled for each order
   - Creates vendor_payables rows
   - Clears the customer's cart
   - Sends "order_paid" SMS notification (best-effort)
```

## Why two entry points call the same function

Checkout.js's browser success callback is fast but not authoritative —
SRS §9 is explicit: *"No order confirmation based only on browser
redirect."* The webhook is authoritative but can take a few seconds to
arrive. Rather than choosing one, both call `finalizePayment()`, which
treats neither caller's data as truth — it re-fetches the payment from
Razorpay's own API before doing anything. Whichever path arrives first
does the real work; the other is a no-op thanks to the idempotency layers
below. This gives fast UX (client path) without weakening the
authoritative guarantee (webhook path, or the independent re-fetch inside
`finalizePayment` itself).

## Idempotency — three independent layers

1. **`payment_events.provider_event_id` is UNIQUE.** The webhook path uses
   Razorpay's `x-razorpay-event-id` header (confirmed via Razorpay's docs
   to be unique per delivery and their own recommended dedup mechanism).
   The client-verify path synthesizes `client_verify:<payment_id>` so it
   can't collide with a real webhook event id. A second attempt with the
   same key is detected before any processing happens.
2. **Conditional UPDATE on `payments.status`.** The transition to
   `captured` uses `.eq("status", ...).neq("status", "captured")` —
   if a racing call already flipped it, this affects zero rows, and that
   is read as "someone else already finalized this," not an error.
3. **`transitionOrder`'s optimistic concurrency** (`lib/orders/state-machine.ts`).
   Each order's `payment_pending → paid` transition requires the row to
   still be in `payment_pending` at write time.

## Signature verification — two different formulas, don't confuse them

| | Formula | Verifies |
|---|---|---|
| Checkout callback | `HMAC-SHA256(order_id + "\|" + payment_id, key_secret)` | The browser's success callback actually came from Razorpay Checkout |
| Webhook | `HMAC-SHA256(raw_request_body, webhook_secret)` | The webhook POST actually came from Razorpay |

`key_secret` (`RAZORPAY_KEY_SECRET`) and `webhook_secret`
(`RAZORPAY_WEBHOOK_SECRET`) are **different values** — the webhook secret
is one you set yourself in the Razorpay Dashboard (Settings → Webhooks),
not derived from your API keys. Mixing these up is a common integration
mistake per Razorpay's own docs.

The webhook signature MUST be verified over the raw, unparsed request
body — `app/api/webhooks/razorpay/route.ts` reads `req.text()` first and
only calls `JSON.parse` after signature verification succeeds.

## Money handling

Every amount is an integer in **paise**, everywhere — `orders.subtotal_paise`,
`payments.amount_paise`, Razorpay's own `amount` field. Razorpay's API
itself operates in the smallest currency subunit (paise for INR), so no
conversion happens at the API boundary; `lib/money.ts` is the only place
paise↔₹ conversion happens, purely for display.

## Commission snapshot timing

Commission rate and amount are computed and written onto each `orders` row
at creation time (`payment_pending`), reading the live
`admin_settings.commission_rate` at that instant. This value is **never
recalculated** later — a Super Admin changing the platform commission rate
afterward has zero effect on already-created orders (SRS §11.5, §23). The
`vendor_payables` row (the actual ledger entry) is only created once
payment is confirmed — an order that's never paid never generates a
payable.

## Exception handling (SRS Phase 3 deliverable)

| Scenario | Handling |
|---|---|
| Webhook redelivered (Razorpay retries on non-2xx) | Deduped via `payment_events.provider_event_id` |
| Client-verify and webhook race | Both safe — see idempotency layers above |
| Amount mismatch between our record and Razorpay | Rejected, audit-logged (`payment.finalize_amount_mismatch`), no orders created/transitioned |
| Payment stuck `authorized`, not `captured` | Defensive capture call; if that also fails, audit-logged, no orders transitioned |
| Pickup slot became infeasible between checkout and payment confirmation | **Order is still honored** — money was captured and V1 has no automated refund path (SRS V2 §C.3). Audit-logged as `order.paid_despite_infeasible_slot` for manual Super Admin follow-up. |
| One order in a multi-restaurant group fails to transition after payment | Doesn't abort the batch — every other order in the group still gets confirmed; the failure is audit-logged (`order.post_payment_transition_failed`) |
| `payment_pending` order abandoned (never paid) | Left as-is, doesn't consume pickup-slot capacity (see `lib/scheduling/capacity.ts`) — a documented cleanup-job candidate, see `docs/KNOWN_ISSUES.md` and `docs/DEPLOYMENT.md` "Scheduled jobs" |

As of Phase 7 these paths do surface in the Super Admin UI: `/admin/operations`
is the V2 §F Live Operations Command Center and raises all eleven alert classes,
including the payment-exception ones, ordered worst-first. They remain queryable
via `audit_logs` filtered by `action` — the alert list is a view over the same
events, not a separate record.

Refunds are still manual and still additive. `recordManualRefund()`
(`lib/actions/admin/refund.ts`, Phase 6) writes a refund ledger row and audits
it; it never edits the original sale, and there is no automated Razorpay refund
call anywhere in the codebase (SRS V2 §C.3 defers that).

## QR fallback (SRS V2 §K) — a deliberately different design than a signed token

The SRS describes the fallback as "a short-lived, non-guessable"
credential. This implementation does **not** generate one. Instead, the
fallback flow (`lib/orders/scan.ts#collectOrderWithFallback`, surfaced in
`components/restaurant/scan-form.tsx`) has staff search their own
restaurant's not-yet-collected orders by the customer's phone number,
select the matching order, provide a mandatory reason, and confirm
collection directly — going through the exact same `transitionOrder` state
machine as a normal scan.

Reasoning: the requirement's substance is "authenticated staff, restaurant-
scoped, cannot bypass any check, fully logged" — all of which this
satisfies without round-tripping a token that would need its own
generation/expiry/verification code path to get right (and couldn't be
tested here). `QR_FALLBACK_SIGNING_SECRET` remains defined in
`.env.example` in case a future team prefers the token-based variant —
it's currently unused.

## Test-mode setup (for whoever runs this next)

1. Create a Razorpay account, switch to **Test Mode** in the dashboard.
2. Copy the test **Key ID** / **Key Secret** into `RAZORPAY_KEY_ID` /
   `RAZORPAY_KEY_SECRET`.
3. Settings → Webhooks → Add New Webhook. URL:
   `https://<your-staging-domain>/api/webhooks/razorpay`. Set a webhook
   secret and put it in `RAZORPAY_WEBHOOK_SECRET`. Subscribe to at least
   `payment.captured` and `payment.failed`.
4. Localhost webhook testing needs a public tunnel (Razorpay doesn't
   deliver to `localhost`) — e.g. ngrok, per Razorpay's own webhook-testing
   docs.
5. Use Razorpay's [documented test card/UPI
   numbers](https://razorpay.com/docs/payments/payments/test-card-upi-details/)
   for test-mode payments (not verified/reproduced here — check current
   docs, they change).
6. Confirm in the Dashboard's API Logs / Webhook Logs that: the Order was
   created with the right amount, the Payment shows `captured`, and the
   webhook shows a `200` response.
