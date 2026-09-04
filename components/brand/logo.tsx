import Image from "next/image";

/**
 * Renders the authoritative UNI8 primary logo asset (SRS §26.1: "Do not
 * distort, stretch, recolour, redraw, or alter supplied marks unless the
 * brand assets explicitly provide that variant.").
 *
 * The source files live in /public/brand (copied verbatim from the
 * supplied brand-asset ZIP — see docs/BRAND.md). This component is the
 * ONE place that references those file paths so a future asset update
 * only needs to change it here.
 */
export function Logo({ variant = "primary", className }: { variant?: "primary" | "symbol" | "mascot" | "lockup"; className?: string }) {
  const src = {
    primary: "/brand/primary-logo.jpg",
    symbol: "/brand/standalone-symbol.jpg",
    mascot: "/brand/mascot.jpg",
    lockup: "/brand/logo-with-mascot.jpg",
  }[variant];

  const alt = {
    primary: "UNI8",
    symbol: "UNI8 symbol",
    mascot: "UNI8 mascot",
    lockup: "UNI8 with mascot",
  }[variant];

  return (
    <Image
      src={src}
      alt={alt}
      width={variant === "symbol" ? 48 : 160}
      height={variant === "symbol" ? 48 : 64}
      className={className}
      priority
    />
  );
}
