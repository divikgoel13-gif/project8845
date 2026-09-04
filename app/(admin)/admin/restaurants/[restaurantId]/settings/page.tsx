import { requireSuperAdmin } from "@/lib/auth/guards";
import { getRestaurantContext, restaurantOperationalState, restaurantStateLabel } from "@/lib/admin/restaurant-context";
import { fmtDateTime, TIMEZONE_NOTE } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge, restaurantStatusTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { OperationsForm, ClassificationForm } from "@/components/admin/restaurant-settings-forms";
import { RestaurantLifecycleControls } from "@/components/admin/restaurant-lifecycle-controls";

/**
 * Restaurant workspace settings (SRS §9, §10.4, V2.6 §29.1 classification, §60 states).
 *
 * Three independent panels, ordered by how reversible they are: operations tuning
 * at the top, classification below it, lifecycle at the bottom. An operator who
 * came here to change a prep time should not have to scroll past an Archive button
 * to find it.
 *
 * Everything on this page is audit logged, and the panels are separate because they
 * file separate audit entries. Combining them into one save would produce a single
 * entry covering two unrelated decisions, which is exactly what makes an audit log
 * useless six months later.
 *
 * Two things this page deliberately does NOT do. It does not edit the commission
 * rate — that is `updateCommissionRate`, reached from the platform's own settings,
 * because a rate change affects the money on future orders and belongs with the
 * financial controls rather than beside a text description. And it does not edit
 * pickup hours: those are three tables with a precedence order and have their own
 * page, because a single combined "settings" form cannot honestly report a partial
 * failure across them.
 */

export const dynamic = "force-dynamic";

export default async function RestaurantSettingsPage({ params }: { params: { restaurantId: string } }) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const restaurant = await getRestaurantContext(restaurantId);

  // The layout has already 404'd an unknown id; this only narrows the type.
  if (!restaurant) return null;

  const state = restaurantOperationalState(restaurant);

  return (
    <div>
      <PageHeader
        title="Restaurant Settings"
        description={`Identity, slot policy, campus classification and trading state. Every change here is audit logged with the account that made it. ${TIMEZONE_NOTE}.`}
        actions={
          <ButtonLink href={`/admin/restaurants/${restaurantId}/pickup`} variant="ghost">
            Pickup schedule
          </ButtonLink>
        }
      />

      <Card>
        <SectionHeading
          title="Operations"
          description="How this restaurant's pickup slots are cut, and what a customer sees at the top of its page. Changes apply to slots generated from now on — an order already booked into a slot keeps the slot it has."
        />
        <OperationsForm
          restaurantId={restaurant.id}
          name={restaurant.name}
          location={restaurant.location}
          description={restaurant.description}
          preparationDefaultMinutes={restaurant.preparationDefaultMinutes}
          gracePeriodMinutes={restaurant.gracePeriodMinutes}
          pickupSlotIntervalMinutes={restaurant.pickupSlotIntervalMinutes}
          defaultSlotCapacity={restaurant.defaultSlotCapacity}
        />
      </Card>

      <Card className="mt-4">
        <SectionHeading
          title="Campus classification"
          description="Whether this restaurant sits inside university grounds. An inside-university restaurant shows the customer a physical-access warning before they order, naming the place below — so this is a statement about campus access, not a label."
        />
        <ClassificationForm
          restaurantId={restaurant.id}
          locationType={restaurant.locationType}
          universityPlaceName={restaurant.universityPlaceName}
        />
      </Card>

      <Card className="mt-4">
        <SectionHeading
          title="Trading state"
          description="Whether the platform accepts new orders here. None of these states cancel an order that already exists — orders already placed must still be fulfilled."
        />

        <dl className="mb-4 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <Detail label="Current state" value={restaurantStateLabel(state)} />
          <Detail
            label="Since"
            value={restaurant.statusChangedAt ? fmtDateTime(restaurant.statusChangedAt) : "Not recorded"}
          />
          <Detail
            label="Paused until"
            value={restaurant.pausedUntil ? fmtDateTime(restaurant.pausedUntil) : "—"}
          />
          <Detail
            label="Stated reason"
            value={restaurant.pausedReason?.trim() || restaurant.closedReason?.trim() || "—"}
          />
        </dl>

        <RestaurantLifecycleControls
          restaurantId={restaurant.id}
          restaurantName={restaurant.name}
          currentStatus={restaurant.status}
        />
      </Card>

      <Card className="mt-4">
        <SectionHeading
          title="Identity"
          description="Read-only. The slug is part of every customer-facing URL for this restaurant, so it is fixed at creation — changing it would break links customers have already saved."
        />
        <dl className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <Detail label="Slug" value={restaurant.slug} />
          <Detail label="Created" value={fmtDateTime(restaurant.createdAt)} />
          <Detail
            label="Archived"
            value={restaurant.archivedAt ? fmtDateTime(restaurant.archivedAt) : "Not archived"}
          />
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Stored status</dt>
            <dd className="mt-0.5">
              <Badge tone={restaurantStatusTone(restaurant.status)}>{restaurant.status}</Badge>
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-ink-muted">
          The stored status is the raw column; the state above resolves it against an elapsed timed pause. They differ
          on purpose — a pause whose end time has passed keeps its reason in the database so the record of why survives.
        </p>
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{value}</dd>
    </div>
  );
}
