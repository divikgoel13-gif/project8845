import { forwardRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "md" | "sm";
};

/**
 * Foundational button primitive. This is intentionally minimal — the full
 * UNI8 component design system (motion, sizes, icon slots) is a Phase 2
 * customer-frontend deliverable per SRS §26.3. What's here establishes the
 * token wiring so later work extends rather than replaces it.
 */
export function buttonClasses(variant: ButtonVariant = "primary", size: "md" | "sm" = "md"): string {
  return cn(
    "inline-flex items-center justify-center rounded-brand font-display font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none",
    size === "md" ? "px-5 py-2.5" : "px-3 py-1.5 text-xs",
    variant === "primary" && "bg-orange-500 text-cream-50 hover:bg-orange-600",
    variant === "secondary" && "bg-maroon-500 text-cream-50 hover:bg-maroon-600",
    variant === "ghost" && "border border-cream-300 bg-transparent text-ink hover:bg-cream-200",
    variant === "danger" && "bg-danger text-cream-50 hover:opacity-90"
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", className, ...props }, ref) => {
    return <button ref={ref} className={cn(buttonClasses(variant, size), className)} {...props} />;
  }
);
Button.displayName = "Button";

/**
 * A link that reads as a button. Phases 7-9 need "Export CSV", "New restaurant"
 * and "Reset filters" to be real navigations rather than click handlers, so that
 * the admin console keeps working without JavaScript and every action is
 * shareable as a URL. Sharing `buttonClasses` keeps the two visually identical —
 * a hand-copied class string is how the two drift apart.
 */
export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Link>, "className"> & {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  className?: string;
}) {
  return (
    <Link href={href} className={cn(buttonClasses(variant, size), className)} {...props}>
      {children}
    </Link>
  );
}
