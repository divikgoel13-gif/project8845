import { requireSuperAdmin } from "@/lib/auth/guards";
import { getNewRestaurantDefaults } from "@/lib/platform/settings";
import { PageHeader } from "@/components/ui/page-header";
import { RestaurantCreateForm } from "@/components/admin/restaurant-create-form";

/**
 * Create a restaurant (SRS §6).
 *
 * The platform defaults are read here purely to be SHOWN, so the operator can see
 * what the new restaurant will start with. The action re-reads them server-side
 * when it inserts — a value rendered into a form is a value a client can change,
 * and prep windows are operational policy.
 */

export const dynamic = "force-dynamic";

export default async function NewRestaurantPage() {
  await requireSuperAdmin();
  const defaults = await getNewRestaurantDefaults();

  return (
    <div>
      <PageHeader
        breadcrumb={[{ label: "Restaurants", href: "/admin/restaurants" }, { label: "New" }]}
        title="New restaurant"
        description={`Starts active, with ${defaults.preparationMinutes} min default preparation, a ${defaults.gracePeriodMinutes} min grace period, ${defaults.slotIntervalMinutes} min pickup slots and ${defaults.slotCapacity} orders per slot.`}
      />
      <RestaurantCreateForm />
    </div>
  );
}
