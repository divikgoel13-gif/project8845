/**
 * CSV export (SRS §14 "Export capabilities where appropriate", §15 audit log
 * export).
 *
 * No `import "server-only"` here on purpose: this is pure string work with no
 * database access, and a client component that renders a small table may want to
 * offer the same download without a round trip.
 *
 * Three things this deliberately gets right, because CSV is where exports
 * usually go wrong:
 *
 *  1. Injection. A cell beginning with =, +, -, @, tab or CR is prefixed with a
 *     single quote. Excel and Sheets treat a leading = as a formula, so an
 *     un-escaped grievance message reading `=HYPERLINK(...)` becomes a live
 *     payload in an operator's spreadsheet. This is the reason to have one
 *     export helper instead of ad-hoc `join(",")` calls.
 *
 *  2. Money. Paise are exported as a decimal rupee STRING built by integer
 *     arithmetic (`lib/money.ts` semantics), never by dividing a float, so an
 *     exported ledger still reconciles with the database to the paise. There is
 *     no currency symbol or thousands separator, because a symbol turns the
 *     column into text and breaks the operator's own SUM.
 *
 *  3. Excel's BOM. Without a UTF-8 BOM, Excel on Windows mis-decodes non-ASCII
 *     names. `toCsvDownload` prepends one; `toCsv` does not, so it stays usable
 *     for machine-to-machine output.
 */

export type CsvColumn<T> = {
  header: string;
  /** Return a primitive; formatting helpers below cover the awkward cases. */
  value: (row: T) => string | number | boolean | null | undefined;
};

const NEEDS_QUOTING = /[",\r\n]/;
const RISKY_PREFIX = /^[=+\-@\t\r]/;

export function escapeCsvCell(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return "";

  let value = typeof raw === "string" ? raw : String(raw);

  // Formula-injection guard. Applied to strings only: a negative number is a
  // legitimate value (a refund line), and quoting it would break arithmetic.
  if (typeof raw === "string" && RISKY_PREFIX.test(value)) {
    value = `'${value}`;
  }

  if (NEEDS_QUOTING.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const lines: string[] = [];
  lines.push(columns.map((c) => escapeCsvCell(c.header)).join(","));

  for (const row of rows) {
    lines.push(columns.map((c) => escapeCsvCell(c.value(row))).join(","));
  }

  // CRLF: RFC 4180, and the only line ending every spreadsheet agrees on.
  return lines.join("\r\n");
}

/** CSV with the UTF-8 BOM Excel needs. Use for anything a human downloads. */
export function toCsvDownload<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  return `﻿${toCsv(rows, columns)}`;
}

/**
 * Response headers for a Server Action / route handler returning a CSV.
 * `filename` is sanitised because it frequently contains a restaurant name.
 */
export function csvResponseHeaders(filename: string): Record<string, string> {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "export";
  return {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${safe.endsWith(".csv") ? safe : `${safe}.csv`}"`,
    // An export is a point-in-time snapshot; a cached one is a wrong one.
    "Cache-Control": "no-store",
  };
}

/** `uni8-orders-2026-08-30.csv` — dated so successive exports do not collide. */
export function csvFilename(prefix: string, now: Date = new Date()): string {
  return `uni8-${prefix}-${now.toISOString().slice(0, 10)}.csv`;
}

// ── cell formatters ───────────────────────────────────────────────────────────

/**
 * Paise → plain decimal rupees, by integer arithmetic. 1234567 → "12345.67",
 * -50 → "-0.50". Matches lib/money.ts so an export reconciles with the ledger.
 */
export function csvPaise(paise: number | null | undefined): string {
  if (paise === null || paise === undefined || !Number.isFinite(paise)) return "";
  const negative = paise < 0;
  const abs = Math.abs(Math.trunc(paise));
  const rupees = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${negative ? "-" : ""}${rupees}.${fraction}`;
}

/**
 * ISO timestamps are exported unchanged, in UTC. Deliberate: a localised string
 * ("30 Aug, 2:05 pm") loses the offset and cannot be sorted or re-imported. The
 * on-screen table is where a reader gets Asia/Kolkata formatting.
 */
export function csvTimestamp(iso: string | null | undefined): string {
  return iso ?? "";
}

/** Booleans as Yes/No — an operator reading a spreadsheet, not a developer. */
export function csvBool(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value ? "Yes" : "No";
}

/** Flattens jsonb (audit metadata, fraud details) into one reviewable cell. */
export function csvJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
