import { redirect } from "next/navigation";
import { getCurrentCartGrouped } from "@/lib/actions/customer/cart";
import { ScheduleForm } from "@/components/customer/schedule-form";

/**
 * Pickup sequence selection (SRS §9: pickup sequence, first restaurant
 * gets an explicit time, subsequent restaurants get a fixed time or
 * "immediately after previous pickup"). The actual sequencing/validation
 * logic lives server-side in lib/actions/customer/schedule.ts — this page
 * only orders the initial list (cart's natural order) and hands off to
 * the client form for reordering + input.
 */
export default async function SchedulePage() {
  const groups = await getCurrentCartGrouped();
  const orderableGroups = groups.filter((g) => g.orderable && g.items.some((i) => i.available));

  if (orderableGroups.length === 0) {
    redirect("/cart");
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-bold">Schedule pickup</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {orderableGroups.length > 1
          ? "Choose the order you'll visit each restaurant, and when."
          : "Choose when you'd like to pick up your order."}
      </p>
      <div className="mt-6">
        <ScheduleForm
          restaurants={orderableGroups.map((g) => ({
            restaurantId: g.restaurantId,
            restaurantName: g.restaurantName,
          }))}
        />
      </div>
    </main>
  );
}
