import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { listReconciliationItems, getReconciliationCounts } from "@/lib/admin/reconciliation";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtCount, fmtDateTime, shortId } from "@/lib/admin/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge, severityTone } from "@/components/ui/badge";
import { Field, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { RunReconciliationScanButton, ReconciliationItemControls } from "@/components/admin/reconciliation-controls";

/**
 * Financial Reconciliation Dashboard (SRS V2 §T). Reads the register a scan
 * writes to (lib/admin/reconciliation.ts) — this page itself performs no
 * detection and no write beyond what `ReconciliationItemControls` triggers
 * through its own audited action. See that module's header for the full
 * reasoning behind every detection rule and the "manual resolution only"
 * boundary this whole feature keeps.
 */

export const dynamic = "force-dynamic";

const ITEM_TYPE_LABELS: Record<string, string> = {
  payment_without_order: "Payment without order",
  order_payment_mismatch: "Order/payment mismatch",
  duplicate_payment_event: "Duplicate payment event",
  refund_mismatch: "Refund mismatch",
  duplicate_payout: "Duplicate payout",
  payable_mismatch: "Payable mismatch",
};

type Query = { status?: string; type?: string; severity?: string; page?: string };

function pickStatus(raw: string | undefined): "open" | "investigating" | "resolved" | "ignored" | "all" {
  return raw === "open" || raw === "investigating" || raw === "resolved" || raw === "ignored" ? raw : "open";
}

function pickSeverity(raw: string | undefined): "info" | "warning" | "critical" | "all" {
  return raw === "info" || raw === "warning" || raw === "critical" ? raw : "all";
}

export default async function ReconciliationPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const status = pickStatus(searchParams.status);
  const severity = pickSeverity(searchParams.severity);
  const itemType = searchParams.type?.trim() || undefined;
  const page = parsePage(searchParams.page);

  const [result, counts] = await Promise.all([
    listReconciliationItems({ status, severity, itemType, page }),
    getReconciliationCounts(),
  ]);

  const carried: Record<string, string | undefined> = {
    status: searchParams.status,
    type: searchParams.type,
    severity: searchParams.severity,
  };
  const openCount = counts.open ?? 0;

  return (
    <div>
      <PageHeader
        title="Financial Reconciliation"
        description="Compares payments, orders, refunds, payables and disbursements for six known mismatch shapes (SRS §T). Detection only ever writes to this register — fixing a real mismatch happens through the normal refund/disburse actions elsewhere, then is marked resolved here."
        actions={
          <Link href="/admin/payments" className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm font-semibold text-ink hover:bg-cream-200">
            Payments
          </Link>
        }
      />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-sm font-semibold text-ink">Run a scan</h2>
            <p className="mt-0.5 text-xs text-ink-muted">
              Looks back 365 days. Never touches orders, payments, refunds, payables or disbursements — only this register.
            </p>
          </div>
          <RunReconciliationScanButton />
        </div>
      </Card>

      <StatGrid>
        <Stat label="Open" value={fmtCount(openCount)} tone={openCount > 0 ? "warning" : "default"} />
        <Stat label="Investigating" value={fmtCount(counts.investigating ?? 0)} />
        <Stat label="Resolved" value={fmtCount(counts.resolved ?? 0)} tone="success" />
        <Stat label="Ignored" value={fmtCount(counts.ignored ?? 0)} />
      </StatGrid>

      <Card className="mt-4">
        <form method="get" action="/admin/payments/reconciliation" className="flex flex-wrap items-end gap-3">
          <Field label="Status" htmlFor="status" className="w-44">
            <Select id="status" name="status" defaultValue={status}>
              <option value="open">Open</option>
              <option value="investigating">Investigating</option>
              <option value="resolved">Resolved</option>
              <option value="ignored">Ignored</option>
              <option value="all">All statuses</option>
            </Select>
          </Field>
          <Field label="Severity" htmlFor="severity" className="w-40">
            <Select id="severity" name="severity" defaultValue={severity}>
              <option value="all">All severities</option>
              <option value="critical">Critical only</option>
              <option value="warning">Warning only</option>
              <option value="info">Info only</option>
            </Select>
          </Field>
          <Field label="Type" htmlFor="type" className="w-56">
            <Select id="type" name="type" defaultValue={itemType ?? ""}>
              <option value="">All types</option>
              {Object.entries(ITEM_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit">Apply</Button>
        </form>
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          title={status === "open" ? "No open mismatches" : "Nothing matches these filters"}
          hint="Run a scan above if one hasn't run recently — this register only shows what the last scan found."
        />
      ) : (
        <div className="mt-4 flex flex-col gap-3">
          {result.rows.map((item) => (
            <Card key={item.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={severityTone(item.severity)}>{item.severity}</Badge>
                    <Badge tone={item.status === "open" ? "warning" : item.status === "investigating" ? "info" : "neutral"}>
                      {item.status}
                    </Badge>
                  </div>
                  <p className="mt-1.5 font-semibold text-ink">{ITEM_TYPE_LABELS[item.itemType] ?? item.itemType}</p>

                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-ink-soft">
                    {item.expectedPaise !== null ? <span>Expected: {paiseToRupeesDisplay(item.expectedPaise)}</span> : null}
                    {item.actualPaise !== null ? <span>Actual: {paiseToRupeesDisplay(item.actualPaise)}</span> : null}
                  </div>

                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                    {item.restaurantName ? (
                      <Link href={`/admin/restaurants/${item.restaurantId}/dashboard`} className="text-ink-soft hover:underline">
                        {item.restaurantName}
                      </Link>
                    ) : null}
                    {item.orderId ? (
                      <Link href={`/admin/orders/${item.orderId}`} className="text-ink-soft hover:underline">
                        Order {shortId(item.orderId)}
                      </Link>
                    ) : null}
                    {item.paymentId ? <span className="font-mono text-ink-muted">Payment {shortId(item.paymentId)}</span> : null}
                    {item.disbursementId ? <span className="font-mono text-ink-muted">Disbursement {shortId(item.disbursementId)}</span> : null}
                    {item.refundEventId ? <span className="font-mono text-ink-muted">Refund {shortId(item.refundEventId)}</span> : null}
                  </div>

                  <p className="mt-1 text-xs text-ink-muted">
                    First detected {fmtDateTime(item.detectedAt)} · last confirmed {fmtDateTime(item.lastSeenAt)}
                  </p>

                  {item.resolutionNote ? (
                    <p className="mt-2 rounded-brand bg-cream-100 p-2 text-xs text-ink-soft">
                      <span className="font-semibold">{item.status === "resolved" ? "Resolution" : item.status === "ignored" ? "Ignored because" : "Note"}:</span>{" "}
                      {item.resolutionNote}
                      {item.resolvedByName ? <span className="text-ink-muted"> — {item.resolvedByName}</span> : null}
                    </p>
                  ) : null}

                  {item.details && Object.keys(item.details as object).length > 0 ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-ink-soft">Evidence</summary>
                      <pre className="mt-1 max-w-md overflow-x-auto rounded-brand bg-cream-100 p-2 text-[11px]">
                        {JSON.stringify(item.details, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </div>
                <ReconciliationItemControls id={item.id} status={item.status} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Pagination className="mt-4" page={result.page} pageSize={result.pageSize} total={result.total} basePath="/admin/payments/reconciliation" params={carried} />
    </div>
  );
}
