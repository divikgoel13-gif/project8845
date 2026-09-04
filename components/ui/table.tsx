import { cn } from "@/lib/cn";

/**
 * Data-table primitives.
 *
 * Phases 7-9 are table-heavy: global orders, the customer directory, both
 * grievance queues, the reconciliation dashboard, the audit log, the
 * walking-time matrix. SRS §27 makes phone-first responsiveness mandatory for
 * ALL dashboards including Super Admin, and a wide table is the single hardest
 * thing to make work on a 375px screen.
 *
 * The approach taken: `TableWrap` puts the table in a horizontally scrollable
 * region with a minimum width, so on a phone the table stays a real table that
 * you swipe sideways, rather than collapsing into stacked cards that lose
 * column alignment (which makes scanning forty orders far worse). Pages that
 * genuinely need a phone-specific layout render a card list at `sm:hidden` and
 * the table at `hidden sm:block` — see the customer directory.
 *
 * No sorting/filtering logic lives here on purpose. Filtering in this app is a
 * server concern (searchParams → SQL) so that a list of 20,000 orders is never
 * shipped to the browser to be sorted client-side.
 */
export function TableWrap({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0", className)}>
      <div className="min-w-[640px]">{children}</div>
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full border-collapse text-sm", className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("border-b border-cream-300 text-left text-xs uppercase tracking-wide text-ink-muted", className)}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-cream-200", className)} {...props} />;
}

export function TR({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("align-middle", className)} {...props} />;
}

export function TH({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("whitespace-nowrap px-3 py-2 font-semibold", className)} {...props} />;
}

export function TD({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2.5 text-ink-soft", className)} {...props} />;
}

/**
 * Numeric cell. Money and counts get tabular alignment so columns of rupee
 * figures line up on the decimal — a readability requirement for the finance
 * pages (SRS §11), not decoration.
 */
export function TDNum({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2.5 text-right tabular-nums text-ink", className)} {...props} />;
}

export function THNum({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold", className)} {...props} />;
}
