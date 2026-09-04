import type { Config } from "tailwindcss";

/**
 * UNI8 design tokens — derived from the supplied brand assets
 * (/mnt/user-data/uploads/UNI8.zip → Primary Logo, Standalone symbol, Mascot,
 * Logo with Mascot), per SRS §26.1 (Mandatory Brand-Asset Inspection) and
 * §26.3 (Design-System Requirements).
 *
 * Extracted visual language:
 *  - Base surface is a warm, slightly yellow cream — never pure white. It reads
 *    as paper/packaging, not a SaaS dashboard.
 *  - Two-color brand mark: a grounded brick-maroon paired with a high-energy
 *    campus orange. Maroon carries weight/trust (wordmark "UNI"), orange
 *    carries energy/motion (the "8" mark, mascot hoodie).
 *  - The "8" mark's negative-space sparkle + rounded terminals signal
 *    playful-but-considered, not corporate-flat.
 *  - Mascot palette adds warm skin tones and near-black (not pure black)
 *    for outerwear/denim — used sparingly for high-contrast text/ink, not
 *    for large surfaces.
 *
 * This is the ONE token source. Do not introduce ad-hoc hex values in
 * components — extend this file instead (SRS §26.1: "do not introduce
 * unrelated colours... merely because they are common in generic templates").
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Warm cream surface family — replaces "white" everywhere in the UI.
        cream: {
          50: "#FFFDF9",
          100: "#FCF3E2", // primary app background (matches brand-asset canvas)
          200: "#F7E7C9",
          300: "#F0D8AC",
          400: "#E4C078",
        },
        // Brand maroon — wordmark, primary actions on light surfaces, trust/weight.
        maroon: {
          50: "#FBEAEA",
          100: "#F0C6C6",
          200: "#DE9494",
          300: "#C56262",
          400: "#AA3E3E",
          500: "#8F2A2A", // core brand maroon
          600: "#7A2323",
          700: "#611B1B",
          800: "#481414",
          900: "#300D0D",
        },
        // Brand orange — the "8" mark, energy, primary CTA, mascot hoodie.
        orange: {
          50: "#FFF3E6",
          100: "#FFDEB3",
          200: "#FFC17A",
          300: "#FCA748",
          400: "#F58B24",
          500: "#EF7D18", // core brand orange
          600: "#D6690F",
          700: "#B0530C",
          800: "#8A400A",
          900: "#5C2A07",
        },
        // Warm near-black ink for text/outlines — never pure #000, echoes
        // the mascot's hair/denim tone so type feels part of the same world.
        ink: {
          DEFAULT: "#241812",
          soft: "#4A3A30",
          muted: "#7A6A5C",
        },
        // Functional colors kept warm-tinted rather than default Tailwind blue/red,
        // so status states don't fight the brand palette.
        success: {
          DEFAULT: "#3E7D44",
          bg: "#E7F3E4",
        },
        warning: {
          DEFAULT: "#B9791A",
          bg: "#FBF0DC",
        },
        danger: {
          DEFAULT: "#B23A2E",
          bg: "#FBE7E3",
        },
        info: {
          DEFAULT: "#2E6FA7",
          bg: "#E3EEF7",
        },
      },
      fontFamily: {
        // Placeholder stacks — Phase 2 customer-frontend work must select and
        // license production web fonts that preserve the wordmark's chunky,
        // rounded-terminal character (see SRS §26.3 Typography row) before
        // this ships. System-font fallbacks only for Phase 1 scaffolding.
        display: [
          "'Sora'",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        body: [
          "'Inter'",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: {
        // Rounded, chunky terminals (see the "8" mark and mascot badge) —
        // component radius should read as friendly, not sharp SaaS corners.
        brand: "1.25rem",
      },
    },
  },
  plugins: [],
};

export default config;
