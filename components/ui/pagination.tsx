import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Server-rendered pagination.
 *
 * Deliberately link-based rather than a client component with state. Every
 * Phase 7-9 list is filtered on the server (searchParams → SQL LIMIT/OFFSET)
 * because the alternative — shipping every order to the browser and paging
 * client-side — stops working the moment the platform has real volume, and
 * would also leak rows the reader is allowed to count but not read.
 *
 * Because it is link-based, a paginated view is shareable and back-button
 * correct: an admin can paste "page 4 of open urgent tickets" into a chat and
 * the recipient sees the same rows.
 */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
  className,
}: {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Total matching rows, from a `count: "exact"` query. */
  total: number;
  basePath: string;
  /** Current filter params to preserve across page changes. */
  params?: Record<string, string | undefined>;
  className?: string;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  const href = (target: number) => {
    const sp = new URLSearchParams();
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value) sp.set(key, value);
    }
    if (target > 1) sp.set("page", String(target));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3", className)}>
      <p className="text-xs text-ink-muted">
        {total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}
      </p>
      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          <PageLink href={href(page - 1)} disabled={page <= 1}>
            Previous
          </PageLink>
          <span className="text-xs tabular-nums text-ink-soft">
            Page {page} of {totalPages}
          </span>
          <PageLink href={href(page + 1)} disabled={page >= totalPages}>
            Next
          </PageLink>
        </div>
      ) : null}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const classes = "rounded-brand border border-cream-300 px-3 py-1.5 text-xs font-semibold";
  if (disabled) {
    // Rendered as a span, not a disabled link: a link that goes nowhere is
    // still focusable and announced as a link by screen readers.
    return <span className={cn(classes, "cursor-not-allowed text-ink-muted opacity-50")}>{children}</span>;
  }
  return (
    <Link href={href} className={cn(classes, "bg-cream-50 text-ink hover:bg-cream-200")}>
      {children}
    </Link>
  );
}

/**
 * Parses the `page` search param. Anything unparseable, zero or negative
 * becomes page 1 rather than throwing — a hand-edited URL should not 500 an
 * admin console.
 */
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/** Standard page size for admin lists. */
export const ADMIN_PAGE_SIZE = 25;

/** Converts a 1-based page into a Supabase `.range()` tuple. */
export function pageRange(page: number, pageSize: number = ADMIN_PAGE_SIZE): [number, number] {
  const start = (page - 1) * pageSize;
  return [start, start + pageSize - 1];
}
