import { requireSuperAdmin } from "@/lib/auth/guards";
import { getRestaurantContext } from "@/lib/admin/restaurant-context";
import { getPickupSchedule } from "@/lib/admin/restaurant-workspace";
import { fmtDuration, TIMEZONE_NOTE } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import {
  WeeklyHoursEditor,
  HourExceptionsEditor,
  CapacityOverridesEditor,
} from "@/components/admin/pickup-schedule-controls";

/**
 * Restaurant workspace pickup schedule (SRS §9 pickup windows, §10.4 slot capacity).
 *
 * The page is laid out in the precedence order `resolveOpenWindow` reads, top to
 * bottom: the weekly shape, then dated overrides of it, then how many orders a
 * single slot may hold. An operator debugging "why can't a customer pick up at
 * 4pm on Friday" walks the page downwards and finds the answer at the first layer
 * that has something to say.
 *
 * All times are campus-local. The columns are bare `time` values with no zone, so
 * a time here is only meaningful next to the fixed +05:30 offset — hence
 * `TIMEZONE_NOTE` on the header rather than buried in a hint.
 *
 * Nothing on this page changes an order that already exists. Narrowing Friday's
 * hours does not cancel a pickup already booked at 4pm; §9 makes slot generation
 * forward-looking, and the operator is told so explicitly because the opposite
 * assumption is the dangerous one.
 */

export const dynamic = "force-dynamic";

export default async function RestaurantPickupPage({ params }: { params: { restaurantId: string } }) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const [restaurant, schedule] = await Promise.all([
    getRestaurantContext(restaurantId),
    getPickupSchedule(restaurantId),
  ]);

  // The layout has already 404'd an unknown id; this only narrows the type.
  if (!restaurant) return null;

  return (
    <div>
      <PageHeader
        title="Pickup Schedule"
        description={`The windows this restaurant's pickup slots are generated from, and the capacity of each slot. Changes apply to slots generated from now on — an order already booked into a slot is unaffected. ${TIMEZONE_NOTE}.`}
      />

      <Card>
        <SectionHeading
          title="Weekly hours"
          description="The recurring shape of the week. A closed day generates no slots at all."
        />
        <p className="mb-2 text-xs text-ink-muted">
          {`Slots are cut every ${fmtDuration(restaurant.pickupSlotIntervalMinutes)} inside these windows, and the last slot of a day must end before closing time. Preparation default is ${fmtDuration(restaurant.preparationDefaultMinutes)}, so the earliest bookable slot sits that far after a customer places an order.`}
        </p>
        <WeeklyHoursEditor restaurantId={restaurantId} hours={schedule.hours} />
      </Card>

      <Card className="mt-4">
        <SectionHeading
          title="Dated exceptions"
          description="One date overriding the weekly shape — a holiday closure, or a day that opens late. The weekly row is left untouched, so the normal schedule returns by itself once the date passes."
        />
        <HourExceptionsEditor restaurantId={restaurantId} exceptions={schedule.exceptions} />
      </Card>

      <Card className="mt-4">
        <SectionHeading
          title="Slot capacity"
          description="How many orders one slot may hold. Removing an override returns that slot to the restaurant's default — it does not set the capacity to zero."
        />
        <CapacityOverridesEditor
          restaurantId={restaurantId}
          overrides={schedule.overrides}
          defaultCapacity={restaurant.defaultSlotCapacity}
        />
      </Card>
    </div>
  );
}
