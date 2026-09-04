# Brand — Asset Inspection Notes (SRS §26)

Per §26.1 ("Mandatory Brand-Asset Inspection"), all four supplied assets
were inspected before any interface generation. Source files are preserved
verbatim in `public/brand/` (copied byte-for-byte from the supplied ZIP,
renamed only for URL-friendliness — see filename mapping below). **These
originals must never be replaced with compressed screenshots or
re-created approximations** (§26.5) — if the asset package is ever
updated, replace these files directly and re-derive the tokens below.

## Assets received

| Supplied filename | Repo path | Used as |
|---|---|---|
| `Primary Logo.jpg` | `public/brand/primary-logo.jpg` | Main wordmark |
| `Standalone symbol.jpg` | `public/brand/standalone-symbol.jpg` | Icon/favicon-scale mark |
| `Mascot.jpg` | `public/brand/mascot.jpg` | Character illustration |
| `Logo with Mascot.jpg` | `public/brand/logo-with-mascot.jpg` | Combined lockup |

All four are rendered only through `components/brand/logo.tsx`, which is
the single place file paths are referenced — this is deliberate so a future
asset refresh (e.g. transparent PNGs instead of flattened JPGs on cream
background) only requires editing one file.

## Extracted visual language

**Color relationships.** The mark uses exactly two brand hues on a warm
cream field, never white: a grounded brick-maroon for the "UNI" wordmark
(weight, trust, legibility) and a high-energy orange for the "8" (motion,
appetite, youth). The cream isn't a neutral backdrop — it's warm/yellow-
tinted, closer to packaging paper than to a SaaS dashboard's white. This
became `cream.100` (`#FCF3E2`) as the app's base background instead of white.

**Logo proportions & shape language.** Letterforms are heavy, rounded-
terminal, and slightly condensed — no sharp corners anywhere in the mark.
The "8" itself carries a negative-space sparkle/motion cutout rather than
being a plain numeral, which is the single most distinctive signature
element in the identity. This shaped the `rounded-brand` (1.25rem) radius
token — component corners should read as chunky/friendly, matching the
wordmark, not as sharp default Tailwind corners.

**Mascot personality.** A grinning, energetic college-aged kid in an
orange "8"-branded hoodie, dark joggers, and sneakers, backpack slung on
one shoulder — reads as street-smart/campus-casual, not corporate or cute-
childish. This is the calibration point for "playful without becoming
childish" (§26.2): the mascot is confident and slightly cheeky, not
cartoonish-innocent. Its palette (warm skin tones, near-black outerwear
details) informed the `ink` token family — text color is a warm near-black
(`#241812`), not a cold pure `#000`, so typography feels part of the same
world as the mascot rather than a separate "UI layer" bolted on top.

**Overall brand feel.** Confident, warm, a little playful, unmistakably
food-and-campus — closer to a well-made streetwear/sneaker brand than to a
generic delivery-app icon set. This directly informs §26.2's Zomato/Swiggy-
adjacent-but-not-cloned direction: the energy level should match those
apps' usability, but the palette and character are UNI8's own.

## Token mapping (see `tailwind.config.ts` for the authoritative values)

| Brand element | Token |
|---|---|
| Wordmark maroon | `maroon.500` `#8F2A2A` (50–900 scale derived around it) |
| "8" mark / mascot hoodie orange | `orange.500` `#EF7D18` (50–900 scale derived around it) |
| Canvas / background | `cream.100` `#FCF3E2` |
| Mascot hair/denim-adjacent dark | `ink.DEFAULT` `#241812` |

## What's deliberately NOT decided yet

*(Status re-checked at end of Phase 8B — the font item below is still open, and
it is now the oldest unresolved brand item in the project.)*

- **Production web fonts.** `tailwind.config.ts` still points
  `font-display`/`font-body` at system-font fallbacks with `Sora`/`Inter` as
  aspirational placeholders. **Neither font is loaded**: there is no
  `next/font` call anywhere in `app/`, no `@font-face`, and no font files in
  `public/`. Every screen through Phase 8 therefore renders in the fallback
  stack, which means no screenshot taken so far shows the intended typography.
  §26.3 requires fonts that "preserve that character" (chunky, rounded,
  confident). Tracked in `docs/KNOWN_ISSUES.md`; the fix is a `next/font`
  declaration in `app/layout.tsx` plus the license terms recorded in
  `docs/THIRD_PARTY_INVENTORY.md`.
- **Motion system, illustration style, empty/loading/error state
  treatments, mascot placement rules.** All explicitly Phase 2 (§26.3
  Motion row, §26.5 required states list).
- **The full §26.5 visual review** (responsive screenshots across
  discovery/menu/cart/checkout/QR pickup/grievance flows) has still not
  happened, and cannot until the app runs — the sandbox has never rendered a
  page. This file remains the Phase 1 inspection record, not the review
  deliverable.

## Token usage note for anyone writing UI here

The palette is narrower than it looks and the compiler is not available to catch
a wrong class name. Numeric shades exist **only** for `cream` (50–400), `maroon`
(50–900) and `orange` (50–900). `ink` has only `DEFAULT`/`soft`/`muted`, and
`success`/`warning`/`danger`/`info` have only `DEFAULT`/`bg`. So `text-ink-soft`
and `text-danger` are real; `text-ink-700` and `text-danger-700` silently render
as nothing. `components/ui/*.tsx` is the reference vocabulary — copy from there
rather than guessing a shade.

## Reminder for whoever builds new surfaces

Re-read SRS §26.4's "Interface Generation Control Prompt" verbatim before
generating any customer-facing screen. Do not start from a generic
food-delivery template and reskin it with these tokens after the fact —
the tokens exist to be designed *from*, not applied on top.
