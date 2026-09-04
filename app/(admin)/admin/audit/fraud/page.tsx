import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { listFraudQueue, getFraudQueueCounts, type FraudQueueRow } from "@/lib/admin/fraud";
import { fmtCount, fmtDateTime } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { FraudFlagControls } from "@/components/admin/fraud-flag-controls";

/**
 * Fraud & abuse review queue (SRS V2 §S), at the route the platform already
 * expects: the Phase 7 dashboard's "Open fraud flags" tile and
 * `lib/admin/live-ops.ts`'s QR-scan-suspicion alert group both already link
 * here as `/admin/audit/fraud` (the latter with `?flag=<id>` to point at one
 * specific flag) — this page's job is to be the destination those two
 * already-shipped links were written for, not to invent a new one.
 *
 * See lib/admin/fraud.ts for the honest state of this feature: the review
 * side (this page) is complete, but no detection call site is wired in yet
 * anywhere in the codebase except this pass's own Financial Reconciliation
 * scan — meaning the Live Ops alert group linking here is also currently
 * empty for the same reason. Empty is the correct default state for a
 * freshly deployed platform either way — a flag should only ever appear
 * here because something genuinely happened.
 */

export const dynamic = "force-dynamic";

type Query = { status?: string; subject?: string; flag?: string };

function pickStatus(raw: string | undefined): "open" | "investigating" | "resolved" | "dismissed" | "all" {
  return raw === "open" || raw === "investigating" || raw === "resolved" || raw === "dismissed" ? raw : "open";
}

function pickSubject(raw: string | undefined): "customer" | "vendor" | "qr" | "all" {
  return raw === "customer" || raw === "vendor" || raw === "qr" ? raw : "all";
}

const SUBJECT_LABEL: Record<string, string> = { customer: "Customer", vendor: "Vendor", qr: "QR / order" };

export default async function FraudReviewPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const status = pickStatus(searchParams.status);
  const subjectType = pickSubject(searchParams.subject);
  const highlightId = searchParams.flag?.trim() || undefined;

  const [{ rows, truncated }, counts] = await Promise.all([
    listFraudQueue({ status, subjectType }),
    getFraudQueueCounts(),
  ]);

  // A deep link from Live Ops (`?flag=<id>`) names one specific flag, which
  // the current status/subject filters may well be excluding — e.g. Live Ops
  // only ever links to OPEN flags, but an operator could arrive here after
  // switching the status filter earlier in the same tab. Rather than a
  // client-side scroll-into-view, the linked flag is fetched on its own
  // (regardless of filters) and shown first, clearly marked — no JS
  // required, and it never silently vanishes because a filter excluded it.
  const highlighted = highlightId ? rows.find((r) => r.id === highlightId) : undefined;
  const linkedButFiltered = highlightId && !highlighted
    ? (await listFraudQueue({ status: "all" })).rows.find((r) => r.id === highlightId)
    : undefined;
  const pinned = highlighted ?? linkedButFiltered;
  const restRows = pinned ? rows.filter((r) => r.id !== pinned.id) : rows;
  const openCount = counts.open ?? 0;

  return (
    <div>
      <PageHeader
        title="Fraud & Abuse Review"
        description="Detection only ever records a flag — it never bans, disables or blocks anything by itself (SRS §S). Every consequence here is a deliberate decision, made on this page."
        actions={
          <Link href="/admin/audit" className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm font-semibold text-ink hover:bg-cream-200">
            Audit Log
          </Link>
        }
      />

      {truncated ? (
        <Card className="mb-4 border-warning bg-warning-bg">
          <p className="text-xs text-warning">The queue has more flags than one scan covers. Counts below are a floor.</p>
        </Card>
      ) : null}

      <StatGrid>
        <Stat label="Open" value={fmtCount(openCount)} tone={openCount > 0 ? "warning" : "default"} />
        <Stat label="Investigating" value={fmtCount(counts.investigating ?? 0)} />
        <Stat label="Resolved" value={fmtCount(counts.resolved ?? 0)} tone="success" />
        <Stat label="Dismissed" value={fmtCount(counts.dismissed ?? 0)} />
      </StatGrid>

      <Card className="mt-4">
        <form method="get" action="/admin/audit/fraud" className="flex flex-wrap items-end gap-3">
          <Field label="Status" htmlFor="status" className="w-48">
            <Select id="status" name="status" defaultValue={status}>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
              <option value="dismissed">Dismissed</option>
              <option value="all">All statuses</option>
            </Select>
          </Field>
          <Field label="Subject" htmlFor="subject" className="w-44">
            <Select id="subject" name="subject" defaultValue={subjectType}>
              <option value="all">All subjects</option>
              <option value="customer">Customer</option>
              <option value="vendor">Vendor</option>
              <option value="qr">QR / order</option>
            </Select>
          </Field>
          <Button type="submit">Apply</Button>
        </form>
      </Card>

      {pinned ? (
        <Card className="mt-4 border-2 border-orange-400">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-orange-600">Linked from Live Operations</p>
          <FraudFlagCard flag={pinned} />
        </Card>
      ) : highlightId ? (
        <Card className="mt-4 border-warning bg-warning-bg">
          <p className="text-xs text-warning">The linked flag could not be found — it may have been removed.</p>
        </Card>
      ) : null}

      {restRows.length === 0 && !pinned ? (
        <EmptyState
          className="mt-4"
          title={status === "open" ? "No open flags" : "No flags match these filters"}
          hint="Flags appear here as soon as a detection call site records one — see this page's own note in lib/admin/fraud.ts for what is and isn't wired in yet."
        />
      ) : restRows.length > 0 ? (
        <div className="mt-4 flex flex-col gap-3">
          {restRows.map((flag) => (
            <Card key={flag.id}>
              <FraudFlagCard flag={flag} />
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FraudFlagCard({ flag }: { flag: FraudQueueRow }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={flag.status === "open" ? "warning" : flag.status === "investigating" ? "info" : "neutral"}>
            {flag.status}
          </Badge>
          <Badge tone="neutral">{SUBJECT_LABEL[flag.subjectType] ?? flag.subjectType}</Badge>
          {flag.occurrences > 1 ? <Badge tone="neutral">×{flag.occurrences}</Badge> : null}
        </div>
        <p className="mt-1.5 font-semibold text-ink">{flag.signalLabel}</p>
        <p className="mt-0.5 text-sm text-ink-soft">
          {flag.subjectHref ? (
            <Link href={flag.subjectHref} className="hover:underline">
              {flag.subjectLabel}
            </Link>
          ) : (
            <span className="font-mono text-xs">{flag.subjectLabel}</span>
          )}
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          First seen {fmtDateTime(flag.createdAt)} · last seen {fmtDateTime(flag.lastSeenAt)}
        </p>
        {flag.resolutionNote ? (
          <p className="mt-2 rounded-brand bg-cream-100 p-2 text-xs text-ink-soft">
            <span className="font-semibold">
              {flag.status === "resolved" ? "Resolution" : flag.status === "dismissed" ? "Dismissal" : "Note"}:
            </span>{" "}
            {flag.resolutionNote}
            {flag.reviewedByName ? <span className="text-ink-muted"> — {flag.reviewedByName}</span> : null}
          </p>
        ) : null}
        {flag.details && Object.keys(flag.details as object).length > 0 ? (
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-ink-soft">Evidence</summary>
            <pre className="mt-1 max-w-md overflow-x-auto rounded-brand bg-cream-100 p-2 text-[11px]">
              {JSON.stringify(flag.details, null, 2)}
            </pre>
          </details>
        ) : null}
      </div>
      <FraudFlagControls id={flag.id} status={flag.status} />
    </div>
  );
}
