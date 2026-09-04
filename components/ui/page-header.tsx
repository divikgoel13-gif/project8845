import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Page header used by every Phase 7-9 admin page.
 *
 * `description` is not decoration: several of these pages present numbers that
 * are legitimately ambiguous (is GMV gross or net of commission? does the
 * outstanding payable include today's uncollected orders?). Stating the
 * definition at the top of the page is cheaper than an admin guessing wrong,
 * and the SRS §14 analytics requirement to "reconcile with source data" is only
 * checkable if the page says what it claims to show.
 *
 * `breadcrumb` exists for the restaurant workspace and Customer 360, where a
 * page is three levels deep and the browser back button is not enough context.
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  actions,
  className,
}: {
  title: string;
  description?: string;
  breadcrumb?: { label: string; href?: string }[];
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("mb-5", className)}>
      {breadcrumb && breadcrumb.length > 0 ? (
        <nav aria-label="Breadcrumb" className="mb-1.5 flex flex-wrap items-center gap-1 text-xs text-ink-muted">
          {breadcrumb.map((crumb, index) => (
            <span key={`${crumb.label}-${index}`} className="flex items-center gap-1">
              {index > 0 ? <span aria-hidden="true">/</span> : null}
              {crumb.href ? (
                <Link href={crumb.href} className="hover:text-ink hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span>{crumb.label}</span>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink sm:text-2xl">{title}</h1>
          {description ? <p className="mt-1 max-w-2xl text-sm text-ink-soft">{description}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

/** Section heading inside a page (Customer 360 tabs, settings groups). */
export function SectionHeading({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex flex-wrap items-start justify-between gap-2", className)}>
      <div>
        <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 max-w-2xl text-xs text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
