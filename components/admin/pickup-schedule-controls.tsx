"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  setRestaurantDayHours,
  upsertHourException,
  deleteHourException,
  upsertCapacityOverride,
  deleteCapacityOverride,
} from "@/lib/actions/admin/restaurant-pickup";
import type { DayHours, HourException, CapacityOverride } from "@/lib/admin/restaurant-workspace";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Checkbox, FormError, FormSuccess } from "@/components/ui/field";

/**
 * Pickup schedule islands (SRS §9 pickup windows, §10.4 slot capacity, V2.6 §60).
 *
 * Three editors rather than one, mirroring the three tables and the precedence
 * order `resolveOpenWindow` reads them in. A combined form would let an operator
 * change "normal Friday" and a festival closure in the same submit, and there is
 * no honest way to report a partial failure of that.
 *
 * Each weekday is its own form with its own state, because the action takes one
 * day at a time: a bad time on Tuesday must not discard a correct edit to Monday.
 *
 * The day names are re-declared here rather than imported from
 * `lib/admin/restaurant-workspace.ts`. That module is `server-only`, and importing
 * a runtime value from it would pull every reader into the client bundle. The
 * types are imported, because `import type` is erased before bundling.
 */

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** `time` columns come back as `HH:MM:SS`; `<input type="time">` wants `HH:MM`. */
function toInputTime(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

/**
 * The actions `parse` their input, so a malformed time arrives as a thrown
 * ZodError rather than a returned `{ ok: false }`. Its first issue message is
 * already written for an operator ("Use a 24-hour time such as 09:30."), so it is
 * surfaced directly instead of being replaced with a generic failure.
 */
function messageOf(cause: unknown): string {
  if (cause && typeof cause === "object" && "issues" in cause) {
    const first = (cause as { issues?: { message?: string }[] }).issues?.[0]?.message;
    if (first) return first;
  }
  return "That change could not be saved. Check the values and try again.";
}

/* ── Weekly hours ───────────────────────────────────────────────────────── */

export function WeeklyHoursEditor({ restaurantId, hours }: { restaurantId: string; hours: DayHours[] }) {
  return (
    <div className="flex flex-col divide-y divide-cream-200">
      {hours.map((day) => (
        <DayRow key={day.dayOfWeek} restaurantId={restaurantId} day={day} />
      ))}
    </div>
  );
}

function DayRow({ restaurantId, day }: { restaurantId: string; day: DayHours }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [isClosed, setIsClosed] = useState(day.isClosed);
  const [opensAt, setOpensAt] = useState(toInputTime(day.opensAt));
  const [closesAt, setClosesAt] = useState(toInputTime(day.closesAt));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function save() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await setRestaurantDayHours({
          restaurantId,
          dayOfWeek: day.dayOfWeek,
          isClosed,
          opensAt,
          closesAt,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(true);
        router.refresh();
      } catch (cause) {
        setError(messageOf(cause));
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 py-3">
      <p className="w-24 shrink-0 pb-2 text-sm font-semibold text-ink">{DAY_LABELS[day.dayOfWeek]}</p>

      <div className="pb-2">
        <Checkbox
          label="Closed"
          checked={isClosed}
          onChange={(event) => setIsClosed(event.currentTarget.checked)}
        />
      </div>

      <Field label="Opens" htmlFor={`opens-${day.dayOfWeek}`} className="w-32">
        <Input
          id={`opens-${day.dayOfWeek}`}
          type="time"
          value={opensAt}
          disabled={isClosed}
          onChange={(event) => setOpensAt(event.currentTarget.value)}
        />
      </Field>

      <Field label="Closes" htmlFor={`closes-${day.dayOfWeek}`} className="w-32">
        <Input
          id={`closes-${day.dayOfWeek}`}
          type="time"
          value={closesAt}
          disabled={isClosed}
          onChange={(event) => setClosesAt(event.currentTarget.value)}
        />
      </Field>

      <div className="pb-2">
        <Button type="button" size="sm" variant="secondary" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="pb-2">
        {saved ? <FormSuccess>Saved.</FormSuccess> : null}
        <FormError>{error}</FormError>
      </div>
    </div>
  );
}

/* ── Dated exceptions ───────────────────────────────────────────────────── */

/**
 * One form for adding or editing, because the action upserts on
 * `(restaurant_id, exception_date)`. Typing a date that already has an exception
 * therefore edits it — which is why the button says "Save exception" and the list
 * below states that re-using a date replaces it.
 */
export function HourExceptionsEditor({
  restaurantId,
  exceptions,
}: {
  restaurantId: string;
  exceptions: HourException[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [exceptionDate, setExceptionDate] = useState("");
  const [isClosed, setIsClosed] = useState(true);
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function submit() {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      try {
        const result = await upsertHourException({
          restaurantId,
          exceptionDate,
          isClosed,
          opensAt,
          closesAt,
          note,
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(`Exception saved for ${exceptionDate}.`);
        setExceptionDate("");
        setNote("");
        router.refresh();
      } catch (cause) {
        setError(messageOf(cause));
      }
    });
  }

  function remove(exceptionId: string) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await deleteHourException({ restaurantId, exceptionId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      {exceptions.length === 0 ? (
        <p className="text-xs text-ink-muted">
          No upcoming exceptions. Past exceptions are not listed — they no longer affect any slot.
        </p>
      ) : (
        <ul className="divide-y divide-cream-200 border-y border-cream-200">
          {exceptions.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm text-ink-soft">
                <span className="font-semibold text-ink">{e.exceptionDate}</span>
                {" — "}
                {e.isClosed
                  ? "closed all day"
                  : `open ${toInputTime(e.opensAt)} to ${toInputTime(e.closesAt)}`}
                {e.note ? <span className="text-ink-muted">{` · ${e.note}`}</span> : null}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(e.id)} disabled={pending}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Date"
          htmlFor="exception-date"
          hint="Re-using a date replaces that exception"
          required
        >
          <Input
            id="exception-date"
            type="date"
            value={exceptionDate}
            onChange={(event) => setExceptionDate(event.currentTarget.value)}
          />
        </Field>

        <Field label="Opens" htmlFor="exception-opens">
          <Input
            id="exception-opens"
            type="time"
            value={opensAt}
            disabled={isClosed}
            onChange={(event) => setOpensAt(event.currentTarget.value)}
          />
        </Field>

        <Field label="Closes" htmlFor="exception-closes">
          <Input
            id="exception-closes"
            type="time"
            value={closesAt}
            disabled={isClosed}
            onChange={(event) => setClosesAt(event.currentTarget.value)}
          />
        </Field>

        <Field label="Note" htmlFor="exception-note" hint="Shown only in this console">
          <Input
            id="exception-note"
            value={note}
            maxLength={200}
            placeholder="Republic Day"
            onChange={(event) => setNote(event.currentTarget.value)}
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Checkbox
          label="Closed all day"
          checked={isClosed}
          onChange={(event) => setIsClosed(event.currentTarget.checked)}
        />
        <Button type="button" size="sm" onClick={submit} disabled={pending || !exceptionDate}>
          {pending ? "Saving…" : "Save exception"}
        </Button>
        {saved ? <FormSuccess>{saved}</FormSuccess> : null}
        <FormError>{error}</FormError>
      </div>
    </div>
  );
}

/* ── Slot capacity overrides ────────────────────────────────────────────── */

/**
 * The scope select exists because the table's XOR is not expressible in a form
 * that shows both a weekday and a date at once: an operator who filled in both
 * would get a validation error explaining a constraint they never intended to
 * touch. Choosing the scope first makes the exclusive choice the visible one.
 *
 * `defaultCapacity` is passed in so the empty state and the "Remove override"
 * wording can name the number the slot falls back to. Removing an override is not
 * the same as setting it to zero, and an operator should not have to guess which.
 */
export function CapacityOverridesEditor({
  restaurantId,
  overrides,
  defaultCapacity,
}: {
  restaurantId: string;
  overrides: CapacityOverride[];
  defaultCapacity: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [scope, setScope] = useState<"weekday" | "date">("weekday");
  const [dayOfWeek, setDayOfWeek] = useState("1");
  const [specificDate, setSpecificDate] = useState("");
  const [slotStart, setSlotStart] = useState("");
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function submit() {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      try {
        const result = await upsertCapacityOverride({
          restaurantId,
          // Exactly one of these is sent. The action's refine rejects both and
          // neither, so the scope select is the only thing keeping them exclusive.
          dayOfWeek: scope === "weekday" ? Number(dayOfWeek) : undefined,
          specificDate: scope === "date" ? specificDate : "",
          slotStart,
          capacity: Number(capacity),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved("Override saved.");
        setSlotStart("");
        setCapacity("");
        router.refresh();
      } catch (cause) {
        setError(messageOf(cause));
      }
    });
  }

  function remove(overrideId: string) {
    setError(null);
    setSaved(null);
    startTransition(async () => {
      const result = await deleteCapacityOverride({ restaurantId, overrideId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      {overrides.length === 0 ? (
        <p className="text-xs text-ink-muted">
          {`No overrides. Every slot holds this restaurant's default of ${defaultCapacity} orders.`}
        </p>
      ) : (
        <ul className="divide-y divide-cream-200 border-y border-cream-200">
          {overrides.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm text-ink-soft">
                <span className="font-semibold text-ink">{toInputTime(o.slotStart)}</span>
                {" on "}
                {o.specificDate ?? (o.dayOfWeek === null ? "every day" : `every ${DAY_LABELS[o.dayOfWeek]}`)}
                {" — "}
                {o.capacity === 0 ? "slot blocked" : `${o.capacity} orders`}
              </span>
              <Button type="button" size="sm" variant="ghost" onClick={() => remove(o.id)} disabled={pending}>
                Remove override
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Applies to" htmlFor="capacity-scope">
          <Select
            id="capacity-scope"
            value={scope}
            onChange={(event) => setScope(event.currentTarget.value === "date" ? "date" : "weekday")}
          >
            <option value="weekday">Every week, on one weekday</option>
            <option value="date">One date only</option>
          </Select>
        </Field>

        {scope === "weekday" ? (
          <Field label="Weekday" htmlFor="capacity-day">
            <Select id="capacity-day" value={dayOfWeek} onChange={(event) => setDayOfWeek(event.currentTarget.value)}>
              {DAY_LABELS.map((label, index) => (
                <option key={label} value={String(index)}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Date" htmlFor="capacity-date" required>
            <Input
              id="capacity-date"
              type="date"
              value={specificDate}
              onChange={(event) => setSpecificDate(event.currentTarget.value)}
            />
          </Field>
        )}

        <Field label="Slot start" htmlFor="capacity-slot" hint="Must match a generated slot" required>
          <Input
            id="capacity-slot"
            type="time"
            value={slotStart}
            onChange={(event) => setSlotStart(event.currentTarget.value)}
          />
        </Field>

        <Field label="Capacity" htmlFor="capacity-value" hint="0 blocks the slot entirely" required>
          <Input
            id="capacity-value"
            type="number"
            min={0}
            max={500}
            step={1}
            value={capacity}
            onChange={(event) => setCapacity(event.currentTarget.value)}
          />
        </Field>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          onClick={submit}
          disabled={pending || !slotStart || capacity === "" || (scope === "date" && !specificDate)}
        >
          {pending ? "Saving…" : "Save override"}
        </Button>
        {saved ? <FormSuccess>{saved}</FormSuccess> : null}
        <FormError>{error}</FormError>
      </div>
    </div>
  );
}
