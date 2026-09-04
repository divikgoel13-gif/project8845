import Link from "next/link";
import { cn } from "@/lib/cn";
import { Card } from "./card";

/**
 * KPI tile. SRS §6 specifies dashboard KPI sets for both the global Super
 * Admin dashboard and every restaurant workspace dashboard; §F adds live-ops
 * counters. This is the shared shape so those numbers read consistently.
 *
 * `href` makes the whole tile a link, because §F.1 requires that "every alert
 * links to the underlying record" — a count with no way to reach the rows
 * behind it is a dead end.
 *
 * `hint` carries the qualifier that stops a number being misread: "today",
 * "excludes cancelled", "gross of commission". Financial KPIs in this app are
 * easy to misinterpret without it (SRS §11.5).
 */
export function Stat({
  label,
  value,
  hint,
  href,
  tone = "default",
  className,
}: {
  label: string;
  value: string | number;
  hint?: string;
  href?: string;
  tone?: "default" | "warning" | "danger" | "success";
  className?: string;
}) {
  const body = (
    <>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p
        className={cn(
          "mt-1 font-display text-2xl font-bold tabular-nums",
          tone === "default" && "text-ink",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
          tone === "success" && "text-success"
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-ink-muted">{hint}</p> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cn("block", className)}>
        <Card className="h-full transition-colors hover:border-orange-300">{body}</Card>
      </Link>
    );
  }

  return <Card className={cn("h-full", className)}>{body}</Card>;
}

/**
 * Responsive KPI grid. One column on a phone, two on a small tablet, four on
 * a laptop — the §27 phone-first requirement applied to the densest part of
 * every dashboard.
 */
export function StatGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4", className)}>{children}</div>
  );
}
