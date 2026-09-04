"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { updateRestaurantOperations, updateRestaurantClassification } from "@/lib/actions/admin/restaurants";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea, Select, FormError, FormSuccess } from "@/components/ui/field";

/**
 * Restaurant settings islands (SRS §9, §10.4, V2.6 §29.1, §60).
 *
 * Two forms rather than one, because the two halves have different blast radius and
 * different audit actions. Operations tune how slots are cut; classification decides
 * whether a customer is shown the §29.2 physical-access warning before they order —
 * a statement UNI8 makes about campus access, not a preference. Submitting both in
 * one request would file one audit entry for two unrelated decisions.
 *
 * Neither form is a live-preview: the numbers here change slots generated from now
 * on and do not touch an order already booked. That is stated on the page rather
 * than implied, because the opposite assumption is the dangerous one.
 */

type Props = {
  restaurantId: string;
  name: string;
  location: string | null;
  description: string | null;
  preparationDefaultMinutes: number;
  gracePeriodMinutes: number;
  pickupSlotIntervalMinutes: number;
  defaultSlotCapacity: number;
};

export function OperationsForm(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(props.name);
  const [location, setLocation] = useState(props.location ?? "");
  const [description, setDescription] = useState(props.description ?? "");
  const [prep, setPrep] = useState(String(props.preparationDefaultMinutes));
  const [grace, setGrace] = useState(String(props.gracePeriodMinutes));
  const [interval, setInterval] = useState(String(props.pickupSlotIntervalMinutes));
  const [capacity, setCapacity] = useState(String(props.defaultSlotCapacity));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await updateRestaurantOperations({
          restaurantId: props.restaurantId,
          name,
          location,
          description,
          preparationDefaultMinutes: Number(prep),
          gracePeriodMinutes: Number(grace),
          pickupSlotIntervalMinutes: Number(interval),
          defaultSlotCapacity: Number(capacity),
        });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(true);
        router.refresh();
      } catch (cause) {
        setError(
          cause && typeof cause === "object" && "issues" in cause
            ? ((cause as { issues?: { message?: string }[] }).issues?.[0]?.message ??
                "Check the values and try again.")
            : "Check the values and try again."
        );
      }
    });
  }

  return (
    <form onSubmit={submit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" htmlFor="ops-name" required hint="Shown to customers">
          <Input id="ops-name" value={name} maxLength={120} onChange={(e) => setName(e.currentTarget.value)} />
        </Field>
        <Field label="Location" htmlFor="ops-location" hint="Where on campus a customer collects">
          <Input
            id="ops-location"
            value={location}
            maxLength={200}
            onChange={(e) => setLocation(e.currentTarget.value)}
          />
        </Field>
      </div>

      <Field label="Description" htmlFor="ops-description" className="mt-3" hint="Customer-facing blurb">
        <Textarea
          id="ops-description"
          value={description}
          maxLength={1000}
          rows={3}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
      </Field>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Preparation default"
          htmlFor="ops-prep"
          required
          hint="Minutes before the earliest bookable slot"
        >
          <Input id="ops-prep" type="number" min={0} max={240} value={prep} onChange={(e) => setPrep(e.currentTarget.value)} />
        </Field>
        <Field label="Grace period" htmlFor="ops-grace" required hint="Minutes after a slot before no-show">
          <Input id="ops-grace" type="number" min={0} max={240} value={grace} onChange={(e) => setGrace(e.currentTarget.value)} />
        </Field>
        <Field label="Slot interval" htmlFor="ops-interval" required hint="Minutes between slot starts">
          <Input
            id="ops-interval"
            type="number"
            min={1}
            max={120}
            value={interval}
            onChange={(e) => setInterval(e.currentTarget.value)}
          />
        </Field>
        <Field label="Default slot capacity" htmlFor="ops-capacity" required hint="Orders per slot, before overrides">
          <Input
            id="ops-capacity"
            type="number"
            min={1}
            max={500}
            value={capacity}
            onChange={(e) => setCapacity(e.currentTarget.value)}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save operations"}
        </Button>
        {saved ? <FormSuccess>Saved. Slots generated from now on use these values.</FormSuccess> : null}
        <FormError>{error}</FormError>
      </div>
    </form>
  );
}

/**
 * §29.1 classification. The place name is required for an inside-university
 * restaurant and forced empty for an outside one, matching the discriminated union
 * the action parses — the field is unmounted rather than disabled so a stale value
 * cannot be submitted after switching.
 *
 * A reason is optional here but offered, because §29.1 only requires the change be
 * audit logged. Turning a restaurant from inside to outside removes a warning
 * customers were being shown, and "who decided that" is the question asked later.
 */
export function ClassificationForm({
  restaurantId,
  locationType,
  universityPlaceName,
}: {
  restaurantId: string;
  locationType: "inside_university" | "outside_university";
  universityPlaceName: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState(locationType);
  const [placeName, setPlaceName] = useState(universityPlaceName ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    startTransition(async () => {
      try {
        const result = await updateRestaurantClassification(
          type === "inside_university"
            ? { restaurantId, reason, locationType: "inside_university", universityPlaceName: placeName }
            : { restaurantId, reason, locationType: "outside_university" }
        );
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setSaved(true);
        router.refresh();
      } catch (cause) {
        setError(
          cause && typeof cause === "object" && "issues" in cause
            ? ((cause as { issues?: { message?: string }[] }).issues?.[0]?.message ??
                "Check the values and try again.")
            : "Check the values and try again."
        );
      }
    });
  }

  return (
    <form onSubmit={submit}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Classification" htmlFor="class-type" required>
          <Select
            id="class-type"
            value={type}
            onChange={(e) =>
              setType(e.currentTarget.value === "inside_university" ? "inside_university" : "outside_university")
            }
          >
            <option value="inside_university">Inside university</option>
            <option value="outside_university">Outside university</option>
          </Select>
        </Field>

        {type === "inside_university" ? (
          <Field
            label="Place on campus"
            htmlFor="class-place"
            required
            hint="Named in the access warning customers see"
          >
            <Input
              id="class-place"
              value={placeName}
              maxLength={120}
              placeholder="Main Building canteen"
              onChange={(e) => setPlaceName(e.currentTarget.value)}
            />
          </Field>
        ) : null}
      </div>

      <Field label="Reason" htmlFor="class-reason" className="mt-3" hint="Recorded in the audit log">
        <Input
          id="class-reason"
          value={reason}
          maxLength={500}
          placeholder="Moved to the gate-side unit"
          onChange={(e) => setReason(e.currentTarget.value)}
        />
      </Field>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving…" : "Save classification"}
        </Button>
        {saved ? <FormSuccess>Saved. The customer-facing access warning follows this setting.</FormSuccess> : null}
        <FormError>{error}</FormError>
      </div>
    </form>
  );
}
