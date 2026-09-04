"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  updateRestaurantOperations,
  pauseRestaurant,
  unpauseRestaurant,
  setRestaurantHours,
  addHourException,
  removeHourException,
  setCapacityOverride,
  removeCapacityOverride,
} from "@/lib/actions/vendor/restaurant-settings";
import type { RestaurantOperationsSettings } from "@/lib/data/vendor-restaurant-settings";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The four SRS V2.6 §60 states in vendor-facing words. A Record keyed by the
 * status union rather than a switch with a default, so adding a fifth state to
 * the enum becomes a type error here instead of silently rendering as "Active".
 */
const VENDOR_STATUS_COPY: Record<RestaurantOperationsSettings["status"], string> = {
  active: "Active",
  paused: "Paused (not accepting new orders)",
  closed: "Closed (not trading)",
  archived: "Archived (removed from UNI8)",
};

/**
 * Vendor Admin restaurant operations settings (SRS Phase 5: pickup-
 * capacity controls, preparation cutoff controls, restaurant operating
 * hours/exceptions). One page, several independent sections — each
 * section manages its own small bit of state and calls its own server
 * action, rather than one giant form, since these are logically separate
 * settings a Vendor Admin would touch at different times.
 */
export function RestaurantSettingsManager({
  restaurantId,
  settings: initialSettings,
}: {
  restaurantId: string;
  settings: RestaurantOperationsSettings;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // --- Pause / unpause -----------------------------------------------
  const [pauseReason, setPauseReason] = useState("");

  function handlePause() {
    setError(null);
    startTransition(async () => {
      try {
        await pauseRestaurant({ restaurantId, pausedUntil: null, reason: pauseReason.trim() || null });
        setSettings((s) => ({ ...s, status: "paused", pausedUntil: null, pausedReason: pauseReason.trim() || null }));
        setPauseReason("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not pause the restaurant.");
      }
    });
  }

  function handleUnpause() {
    setError(null);
    startTransition(async () => {
      try {
        await unpauseRestaurant({ restaurantId });
        setSettings((s) => ({ ...s, status: "active", pausedUntil: null, pausedReason: null }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not unpause the restaurant.");
      }
    });
  }

  // --- Operations (cutoff / grace / slot interval / capacity) --------
  const [ops, setOps] = useState({
    preparationDefaultMinutes: String(settings.preparationDefaultMinutes),
    gracePeriodMinutes: String(settings.gracePeriodMinutes),
    pickupSlotIntervalMinutes: String(settings.pickupSlotIntervalMinutes),
    defaultSlotCapacity: String(settings.defaultSlotCapacity),
  });

  function handleSaveOps(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const payload = {
      restaurantId,
      preparationDefaultMinutes: Number(ops.preparationDefaultMinutes),
      gracePeriodMinutes: Number(ops.gracePeriodMinutes),
      pickupSlotIntervalMinutes: Number(ops.pickupSlotIntervalMinutes),
      defaultSlotCapacity: Number(ops.defaultSlotCapacity),
    };
    if (Object.values(payload).some((v, i) => i > 0 && Number.isNaN(v))) {
      setError("All operations fields must be valid numbers.");
      return;
    }
    startTransition(async () => {
      try {
        await updateRestaurantOperations(payload);
        setSettings((s) => ({ ...s, ...payload }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save operations settings.");
      }
    });
  }

  // --- Weekly hours ----------------------------------------------------
  const hoursByDay = new Map(settings.hours.map((h) => [h.dayOfWeek, h]));

  function handleSaveDay(dayOfWeek: number, isClosed: boolean, opensAt: string, closesAt: string) {
    setError(null);
    startTransition(async () => {
      try {
        await setRestaurantHours({
          restaurantId,
          dayOfWeek,
          isClosed,
          opensAt: isClosed ? null : opensAt,
          closesAt: isClosed ? null : closesAt,
        });
        setSettings((s) => ({
          ...s,
          hours: [
            ...s.hours.filter((h) => h.dayOfWeek !== dayOfWeek),
            { dayOfWeek, isClosed, opensAt: isClosed ? null : opensAt, closesAt: isClosed ? null : closesAt },
          ].sort((a, b) => a.dayOfWeek - b.dayOfWeek),
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save hours.");
      }
    });
  }

  // --- Exceptions --------------------------------------------------------
  const [exceptionForm, setExceptionForm] = useState({ date: "", isClosed: true, opensAt: "", closesAt: "", note: "" });

  function handleAddException(e: React.FormEvent) {
    e.preventDefault();
    if (!exceptionForm.date) return;
    setError(null);
    startTransition(async () => {
      try {
        await addHourException({
          restaurantId,
          exceptionDate: exceptionForm.date,
          isClosed: exceptionForm.isClosed,
          opensAt: exceptionForm.isClosed ? null : exceptionForm.opensAt || null,
          closesAt: exceptionForm.isClosed ? null : exceptionForm.closesAt || null,
          note: exceptionForm.note.trim() || null,
        });
        setSettings((s) => ({
          ...s,
          exceptions: [
            ...s.exceptions.filter((ex) => ex.exceptionDate !== exceptionForm.date),
            {
              id: crypto.randomUUID(),
              exceptionDate: exceptionForm.date,
              isClosed: exceptionForm.isClosed,
              opensAt: exceptionForm.isClosed ? null : exceptionForm.opensAt || null,
              closesAt: exceptionForm.isClosed ? null : exceptionForm.closesAt || null,
              note: exceptionForm.note.trim() || null,
            },
          ].sort((a, b) => a.exceptionDate.localeCompare(b.exceptionDate)),
        }));
        setExceptionForm({ date: "", isClosed: true, opensAt: "", closesAt: "", note: "" });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add exception.");
      }
    });
  }

  function handleRemoveException(exceptionId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await removeHourException({ restaurantId, exceptionId });
        setSettings((s) => ({ ...s, exceptions: s.exceptions.filter((ex) => ex.id !== exceptionId) }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not remove exception.");
      }
    });
  }

  // --- Capacity overrides -----------------------------------------------
  const [overrideForm, setOverrideForm] = useState({ scope: "day_of_week" as "day_of_week" | "specific_date", dayOfWeek: "1", specificDate: "", slotStart: "12:00", capacity: "0" });

  function handleAddOverride(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const capacity = Number(overrideForm.capacity);
    if (Number.isNaN(capacity) || capacity < 0) {
      setError("Capacity must be a non-negative number.");
      return;
    }
    startTransition(async () => {
      try {
        await setCapacityOverride({
          restaurantId,
          scope: overrideForm.scope,
          dayOfWeek: overrideForm.scope === "day_of_week" ? Number(overrideForm.dayOfWeek) : null,
          specificDate: overrideForm.scope === "specific_date" ? overrideForm.specificDate : null,
          slotStart: `${overrideForm.slotStart}:00`,
          capacity,
        });
        setSettings((s) => ({
          ...s,
          capacityOverrides: [
            ...s.capacityOverrides,
            {
              id: crypto.randomUUID(),
              dayOfWeek: overrideForm.scope === "day_of_week" ? Number(overrideForm.dayOfWeek) : null,
              specificDate: overrideForm.scope === "specific_date" ? overrideForm.specificDate : null,
              slotStart: `${overrideForm.slotStart}:00`,
              capacity,
            },
          ],
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not add capacity override.");
      }
    });
  }

  function handleRemoveOverride(overrideId: string) {
    setError(null);
    startTransition(async () => {
      try {
        await removeCapacityOverride({ restaurantId, overrideId });
        setSettings((s) => ({ ...s, capacityOverrides: s.capacityOverrides.filter((o) => o.id !== overrideId) }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not remove override.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="rounded-brand bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}

      <Card>
        <h2 className="font-display font-semibold">Restaurant status</h2>
        {/*
          Four states, not two (SRS V2.6 §60). This card previously tested
          `status === "paused"` and treated everything else as Active, which
          would have shown a closed or archived restaurant as trading and
          offered a Pause button whose Server Action would then refuse. A vendor
          admin owns Pause (§G) but not Closed or Archived (§32 puts those in
          Super Admin scope), so those two render read-only with the reason the
          super admin recorded.
        */}
        <p className="mt-1 text-sm text-ink-soft">
          Currently:{" "}
          <span
            className={`font-medium ${
              settings.status === "active" ? "text-success" : "text-danger"
            }`}
          >
            {VENDOR_STATUS_COPY[settings.status]}
          </span>
          {settings.status === "paused" && settings.pausedReason
            ? ` — ${settings.pausedReason}`
            : null}
          {settings.status === "closed" && settings.closedReason
            ? ` — ${settings.closedReason}`
            : null}
        </p>

        {settings.status === "paused" ? (
          <Button onClick={handleUnpause} disabled={isPending} className="mt-3">
            Resume accepting orders
          </Button>
        ) : settings.status === "active" ? (
          <div className="mt-3 flex gap-2">
            <input
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              placeholder="Reason (optional)"
              className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
            />
            <Button onClick={handlePause} disabled={isPending} variant="secondary">
              Pause restaurant
            </Button>
          </div>
        ) : (
          <p className="mt-3 rounded-brand bg-cream-200 px-3 py-2 text-xs text-ink-soft">
            Only UNI8 support can change this status. Existing paid orders remain
            collectable, and payouts for completed orders are unaffected.
          </p>
        )}

        <p className="mt-2 text-xs text-ink-muted">
          Pausing blocks new orders only — existing scheduled/preparing orders are unaffected.
        </p>
      </Card>

      <Card>
        <h2 className="font-display font-semibold">Pickup operations</h2>
        <form onSubmit={handleSaveOps} className="mt-3 grid grid-cols-2 gap-3">
          <label className="text-sm font-medium">
            Preparation cutoff (minutes)
            <input
              type="number"
              min="0"
              value={ops.preparationDefaultMinutes}
              onChange={(e) => setOps((o) => ({ ...o, preparationDefaultMinutes: e.target.value }))}
              className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm font-medium">
            Grace period (minutes)
            <input
              type="number"
              min="0"
              value={ops.gracePeriodMinutes}
              onChange={(e) => setOps((o) => ({ ...o, gracePeriodMinutes: e.target.value }))}
              className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm font-medium">
            Pickup slot length (minutes)
            <input
              type="number"
              min="5"
              value={ops.pickupSlotIntervalMinutes}
              onChange={(e) => setOps((o) => ({ ...o, pickupSlotIntervalMinutes: e.target.value }))}
              className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-sm font-medium">
            Orders per slot
            <input
              type="number"
              min="1"
              value={ops.defaultSlotCapacity}
              onChange={(e) => setOps((o) => ({ ...o, defaultSlotCapacity: e.target.value }))}
              className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
            />
          </label>
          <Button type="submit" disabled={isPending} className="col-span-2 self-start">
            Save
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="font-display font-semibold">Weekly hours</h2>
        <div className="mt-3 flex flex-col gap-2">
          {DAY_NAMES.map((name, dayOfWeek) => {
            const existing = hoursByDay.get(dayOfWeek);
            return (
              <DayRow
                key={dayOfWeek}
                name={name}
                dayOfWeek={dayOfWeek}
                isClosed={existing?.isClosed ?? true}
                opensAt={existing?.opensAt ?? "09:00"}
                closesAt={existing?.closesAt ?? "18:00"}
                disabled={isPending}
                onSave={handleSaveDay}
              />
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="font-display font-semibold">Upcoming exceptions (holidays, one-off closures)</h2>
        <form onSubmit={handleAddException} className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm font-medium">
            Date
            <input
              type="date"
              value={exceptionForm.date}
              onChange={(e) => setExceptionForm((f) => ({ ...f, date: e.target.value }))}
              className="mt-1 rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
              required
            />
          </label>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={exceptionForm.isClosed}
              onChange={(e) => setExceptionForm((f) => ({ ...f, isClosed: e.target.checked }))}
            />
            Closed all day
          </label>
          {!exceptionForm.isClosed && (
            <>
              <input
                type="time"
                value={exceptionForm.opensAt}
                onChange={(e) => setExceptionForm((f) => ({ ...f, opensAt: e.target.value }))}
                className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
              />
              <input
                type="time"
                value={exceptionForm.closesAt}
                onChange={(e) => setExceptionForm((f) => ({ ...f, closesAt: e.target.value }))}
                className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
              />
            </>
          )}
          <input
            value={exceptionForm.note}
            onChange={(e) => setExceptionForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Note (optional)"
            className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
          />
          <Button type="submit" disabled={isPending}>
            Add
          </Button>
        </form>

        {settings.exceptions.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {settings.exceptions.map((ex) => (
              <li key={ex.id} className="flex items-center justify-between border-t border-cream-300 pt-2">
                <span>
                  {ex.exceptionDate} — {ex.isClosed ? "Closed" : `${ex.opensAt}–${ex.closesAt}`}
                  {ex.note && ` (${ex.note})`}
                </span>
                <button onClick={() => handleRemoveException(ex.id)} disabled={isPending} className="text-danger underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="font-display font-semibold">Per-slot capacity overrides</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Override the default "{settings.defaultSlotCapacity} orders per slot" for a specific weekday or date. Set
          capacity to 0 to fully block a slot.
        </p>
        <form onSubmit={handleAddOverride} className="mt-3 flex flex-wrap items-end gap-2">
          <select
            value={overrideForm.scope}
            onChange={(e) => setOverrideForm((f) => ({ ...f, scope: e.target.value as "day_of_week" | "specific_date" }))}
            className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
          >
            <option value="day_of_week">Every week on…</option>
            <option value="specific_date">One specific date…</option>
          </select>
          {overrideForm.scope === "day_of_week" ? (
            <select
              value={overrideForm.dayOfWeek}
              onChange={(e) => setOverrideForm((f) => ({ ...f, dayOfWeek: e.target.value }))}
              className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
            >
              {DAY_NAMES.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </select>
          ) : (
            <input
              type="date"
              value={overrideForm.specificDate}
              onChange={(e) => setOverrideForm((f) => ({ ...f, specificDate: e.target.value }))}
              className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
              required
            />
          )}
          <input
            type="time"
            value={overrideForm.slotStart}
            onChange={(e) => setOverrideForm((f) => ({ ...f, slotStart: e.target.value }))}
            className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
          />
          <input
            type="number"
            min="0"
            value={overrideForm.capacity}
            onChange={(e) => setOverrideForm((f) => ({ ...f, capacity: e.target.value }))}
            placeholder="Capacity"
            className="w-24 rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
          />
          <Button type="submit" disabled={isPending}>
            Add override
          </Button>
        </form>

        {settings.capacityOverrides.length > 0 && (
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {settings.capacityOverrides.map((o) => (
              <li key={o.id} className="flex items-center justify-between border-t border-cream-300 pt-2">
                <span>
                  {o.specificDate ?? DAY_NAMES[o.dayOfWeek ?? 0]} at {o.slotStart.slice(0, 5)} → capacity {o.capacity}
                </span>
                <button onClick={() => handleRemoveOverride(o.id)} disabled={isPending} className="text-danger underline">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function DayRow({
  name,
  dayOfWeek,
  isClosed: initialClosed,
  opensAt: initialOpensAt,
  closesAt: initialClosesAt,
  disabled,
  onSave,
}: {
  name: string;
  dayOfWeek: number;
  isClosed: boolean;
  opensAt: string;
  closesAt: string;
  disabled: boolean;
  onSave: (dayOfWeek: number, isClosed: boolean, opensAt: string, closesAt: string) => void;
}) {
  const [isClosed, setIsClosed] = useState(initialClosed);
  const [opensAt, setOpensAt] = useState(initialOpensAt.slice(0, 5));
  const [closesAt, setClosesAt] = useState(initialClosesAt.slice(0, 5));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 text-sm font-medium">{name}</span>
      <label className="flex items-center gap-1 text-xs text-ink-soft">
        <input type="checkbox" checked={isClosed} onChange={(e) => setIsClosed(e.target.checked)} />
        Closed
      </label>
      {!isClosed && (
        <>
          <input
            type="time"
            value={opensAt}
            onChange={(e) => setOpensAt(e.target.value)}
            className="rounded-brand border border-cream-300 bg-cream-50 px-2 py-1 text-sm"
          />
          <span className="text-ink-muted">–</span>
          <input
            type="time"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
            className="rounded-brand border border-cream-300 bg-cream-50 px-2 py-1 text-sm"
          />
        </>
      )}
      <button
        onClick={() => onSave(dayOfWeek, isClosed, opensAt, closesAt)}
        disabled={disabled}
        className="rounded-full bg-cream-200 px-2.5 py-1 text-xs font-medium text-ink-soft"
      >
        Save
      </button>
    </div>
  );
}
