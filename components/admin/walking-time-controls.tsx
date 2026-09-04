"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  setWalkingTime,
  setWalkingTimeBothWays,
  clearWalkingTime,
} from "@/lib/actions/admin/walking-times";
import { Button } from "@/components/ui/button";
import { Input, FormError, FormSuccess } from "@/components/ui/field";
import { Badge, restaurantStatusTone } from "@/components/ui/badge";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";
import type { WalkingTimeRow } from "@/lib/admin/restaurant-workspace";

/**
 * Walking-time matrix editor (SRS §2 walking-time matrix, §9, V2.6 §U).
 *
 * One row per other restaurant, each row its own independent form. The pair is
 * edited together because that is how the operator thinks about it ("how far is
 * it from here to the library canteen"), but SAVED as one or two directional
 * writes because `walking_times` is unique on `(from, to)` and campus geography
 * can be asymmetric — a one-way gate, a stairwell that is only an exit.
 *
 * Two facts about how the number is READ shape every label here, and both come
 * from `getWalkingTimeMinutes` in `lib/scheduling/walking-time.ts`:
 *
 *  1. A missing forward edge falls back to the REVERSE edge, not to a default.
 *     So one direction configured already serves both directions. Filling in the
 *     second box is for the case where the return walk genuinely differs.
 *  2. With NEITHER direction set the reader returns null, and
 *     `resolveImmediateAfterTime` then refuses to schedule: a customer building a
 *     group order across these two restaurants cannot use "immediately after
 *     previous pickup" at all and is told so. An unset pair is a blocked feature,
 *     not a silently-guessed number — which is why Clear says so plainly and why
 *     0 is never written in place of "not set".
 *
 * `WalkingTimeRow` is imported as a type only. `lib/admin/restaurant-workspace.ts`
 * begins `import "server-only"`, so importing a runtime value from it here would
 * pull every workspace reader into the client bundle; `import type` is erased
 * before bundling.
 */

export function WalkingTimesEditor({
  restaurantId,
  restaurantName,
  rows,
}: {
  restaurantId: string;
  restaurantName: string;
  rows: WalkingTimeRow[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        There is no other active restaurant on the platform, so there is no pair to measure. Walking times appear here
        as soon as a second restaurant exists.
      </p>
    );
  }

  return (
    <TableWrap>
      <Table>
        <THead>
          <TR>
            <TH>Restaurant</TH>
            <THNum>To there (min)</THNum>
            <THNum>Back here (min)</THNum>
            <TH>Actions</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <PairRow key={row.otherId} restaurantId={restaurantId} restaurantName={restaurantName} row={row} />
          ))}
        </TBody>
      </Table>
    </TableWrap>
  );
}

/**
 * The actions `.parse()` their input, so a value outside 0–240 arrives as a
 * thrown ZodError rather than a returned `{ ok: false }`. Its first issue message
 * is already written for a reader, so it is surfaced instead of being replaced
 * with a generic failure.
 */
function messageOf(cause: unknown): string {
  if (cause && typeof cause === "object" && "issues" in cause) {
    const first = (cause as { issues?: { message?: string }[] }).issues?.[0]?.message;
    if (first) return first;
  }
  return "That walking time could not be saved. Use a whole number of minutes between 0 and 240.";
}

function toInput(value: number | null): string {
  return value === null ? "" : String(value);
}

function PairRow({
  restaurantId,
  restaurantName,
  row,
}: {
  restaurantId: string;
  restaurantName: string;
  row: WalkingTimeRow;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [outbound, setOutbound] = useState(toInput(row.outboundMinutes));
  const [inbound, setInbound] = useState(toInput(row.inboundMinutes));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const isSet = row.outboundMinutes !== null || row.inboundMinutes !== null;

  function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(done);
        router.refresh();
      } catch (cause) {
        setError(messageOf(cause));
      }
    });
  }

  function saveBothWays() {
    // The outbound box is the source for a symmetric save. Taking whichever box
    // happens to be filled would make the result depend on which one the
    // operator typed in last.
    if (outbound.trim() === "") {
      setError("Enter the minutes in the “To there” box before saving both ways.");
      return;
    }
    run(
      () =>
        setWalkingTimeBothWays({
          fromRestaurantId: restaurantId,
          toRestaurantId: row.otherId,
          minutes: Number(outbound.trim()),
        }),
      `Saved ${outbound.trim()} minutes in both directions.`
    );
  }

  function saveDirections() {
    const wantOut = outbound.trim();
    const wantIn = inbound.trim();
    if (wantOut === "" && wantIn === "") {
      setError("Enter at least one direction, or use Clear to remove the pair.");
      return;
    }
    run(async () => {
      // Sequential rather than parallel: two writes to the same pair, and a
      // serial pair yields a truthful partial-failure message instead of an
      // ambiguous one. An unchanged box is skipped so a no-op save does not file
      // an audit entry claiming a change.
      if (wantOut !== "" && wantOut !== toInput(row.outboundMinutes)) {
        const out = await setWalkingTime({
          fromRestaurantId: restaurantId,
          toRestaurantId: row.otherId,
          minutes: Number(wantOut),
        });
        if (!out.ok) return out;
      }
      if (wantIn !== "" && wantIn !== toInput(row.inboundMinutes)) {
        const back = await setWalkingTime({
          fromRestaurantId: row.otherId,
          toRestaurantId: restaurantId,
          minutes: Number(wantIn),
        });
        if (!back.ok) return back;
      }
      return { ok: true as const };
    }, "Saved. Each direction is stored on its own.");
  }

  function clearPair() {
    run(
      () =>
        clearWalkingTime({
          fromRestaurantId: restaurantId,
          toRestaurantId: row.otherId,
          bothWays: true,
        }),
      `Removed. A customer can no longer chain ${restaurantName} and ${row.otherName} with “immediately after previous pickup”.`
    );
  }

  return (
    <TR className="align-top">
      <TD>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">{row.otherName}</span>
          {row.otherStatus === "active" ? null : (
            <Badge tone={restaurantStatusTone(row.otherStatus)}>{row.otherStatus}</Badge>
          )}
          {isSet ? null : <Badge tone="warning">Not set</Badge>}
        </div>
        <p className="mt-0.5 text-xs text-ink-muted">
          {isSet
            ? `On foot between ${restaurantName} and ${row.otherName}, at a pace a customer carrying food can keep.`
            : `Neither direction is set, so a group order cannot chain ${restaurantName} and ${row.otherName} by walking time.`}
        </p>
        <FormError>{error}</FormError>
        <FormSuccess>{saved}</FormSuccess>
      </TD>

      <TDNum className="w-28">
        <Input
          type="number"
          min={0}
          max={240}
          value={outbound}
          aria-label={`Minutes from ${restaurantName} to ${row.otherName}`}
          placeholder="Not set"
          onChange={(e) => setOutbound(e.currentTarget.value)}
        />
      </TDNum>

      <TDNum className="w-28">
        <Input
          type="number"
          min={0}
          max={240}
          value={inbound}
          aria-label={`Minutes from ${row.otherName} to ${restaurantName}`}
          placeholder="Not set"
          onChange={(e) => setInbound(e.currentTarget.value)}
        />
      </TDNum>

      <TD>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={saveBothWays} disabled={pending}>
            {pending ? "Saving…" : "Save both ways"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={saveDirections} disabled={pending}>
            Save directions
          </Button>
          {isSet ? (
            <Button type="button" size="sm" variant="ghost" onClick={clearPair} disabled={pending}>
              Clear
            </Button>
          ) : null}
        </div>
      </TD>
    </TR>
  );
}
