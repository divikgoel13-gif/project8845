# Third-Party Inventory

Current through Phase 8B. Every dependency currently in `package.json`, why it's
there, and its license. **Phases 4–8 added no new dependencies** — the
dependency list below is byte-for-byte what Handover 1 shipped, which is
deliberate: the sandbox cannot install anything (npm returns 403), so every
feature since has been built on what was already declared. None have actually
been `npm install`-ed in this environment — versions are pinned as of authoring;
license info is from general knowledge of each package, not re-verified against
the specific pinned version's LICENSE file, and should be spot-checked once
`node_modules` actually exists.

## Runtime dependencies

| Package | Version | Purpose | License |
|---|---|---|---|
| `next` | 14.2.5 | App framework | MIT |
| `react`, `react-dom` | 18.3.1 | UI runtime | MIT |
| `@supabase/ssr` | 0.4.0 | Supabase client for Next.js SSR/cookie handling | MIT |
| `@supabase/supabase-js` | 2.45.4 | Supabase client (DB, Auth, Storage) | MIT |
| `zod` | 3.23.8 | Runtime input validation for every Server Action | MIT |
| `clsx` | 2.1.1 | Conditional className composition | MIT |
| `tailwind-merge` | 2.5.2 | Resolves conflicting Tailwind utility classes (see `lib/cn.ts`) | MIT |
| `date-fns` | 3.6.0 | Date utilities (still not used as of Phase 8 — see `lib/scheduling/timezone.ts`'s note on why timezone math is hand-rolled instead) | MIT |
| `date-fns-tz` | 3.1.3 | Timezone-aware date utilities (same note — currently unused) | MIT |
| `qrcode` | 1.5.4 | Server-side QR code image generation (customer pickup QR) | MIT |

Two things worth noting for whoever does the Phase 10 audit:

- `date-fns`/`date-fns-tz` are declared but unused. Either adopt them (which
  would let `lib/scheduling/timezone.ts` drop its hand-rolled `+05:30`
  arithmetic) or remove them; leaving a declared-but-unused date library next to
  hand-rolled date code is the kind of thing that invites someone to "helpfully"
  mix the two.
- Nothing in the codebase generates CSV, signs URLs, or parses multipart bodies
  via a library. CSV is `lib/admin/csv.ts`, signed URLs come from
  `@supabase/supabase-js`'s Storage API, and uploads go browser→bucket directly.
  That is why the dependency count has not moved in five phases.

## Verification tooling

`scripts/verify-static.mjs` — the project's actual test harness — imports
**nothing outside `node:*`** on purpose, so it runs in an environment with no
`node_modules`. It is not a dependency and adds no license surface.

## Dev dependencies

| Package | Version | Purpose | License |
|---|---|---|---|
| `typescript` | 5.5.4 | Type checking | Apache-2.0 |
| `@types/node`, `@types/react`, `@types/react-dom`, `@types/qrcode` | — | Type definitions | MIT |
| `tailwindcss` | 3.4.9 | Utility-first CSS, brand design tokens | MIT |
| `postcss`, `autoprefixer` | — | CSS tooling | MIT |
| `eslint`, `eslint-config-next` | 8.57.0 / 14.2.5 | Linting | MIT |
| `supabase` (CLI) | 1.191.3 | Migrations, local dev stack | MIT / Apache-2.0 |

## External services (not npm packages, but load-bearing)

| Service | Purpose | Pricing model (as of authoring — reverify before production) |
|---|---|---|
| Supabase | Postgres + Auth + Storage | Free tier + usage-based paid tiers |
| Razorpay | Payment collection | Transaction-fee-based, India-focused |
| SMS provider | Not yet selected (SRS §Y) | TBD — selection criteria documented in the SRS itself |

## Fonts

`tailwind.config.ts` currently declares `Sora`/`Inter` as aspirational
font stacks (see `docs/BRAND.md`) — **neither is actually loaded/licensed
yet.** No font files or `@font-face` declarations exist in this codebase.
Whoever picks the actual production typeface needs to add both the
license terms and the loading mechanism (Next.js `next/font`, a CDN link,
or self-hosted files) to this inventory.

## Brand assets

The four files in `public/brand/` (logo, symbol, mascot, lockup) are
supplied brand assets, not third-party/licensed stock — see
`docs/BRAND.md` for provenance. Not a licensing concern, but noted here
for completeness of "everything in the asset pipeline."
