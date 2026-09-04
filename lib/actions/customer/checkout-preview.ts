import "server-only";
import { requireRole } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { checkPickupFeasibility, FEASIBILITY_MESSAGES } from "@/lib/scheduling/feasibility";
import { getCurrentCartGrouped } from "@/lib/actions/customer/cart";

export type CheckoutRestaurantSummary = {
  restaurantId: string;
  restaurantName: string;
  pickupTime: string;
  sequenceNo: number;
  items: { name: string; pricePaise: number; quantity: number }[];
  subtotalPaise: number;
};

export type CheckoutPreviewResult =
  | { valid: true; groupId: string; restaurants: CheckoutRestaurantSummary[]; grandTotalPaise: number }
  | { valid: false; issues: string[] };

/**
 * Re-validates a previously-confirmed pickup schedule immediately before
 * showing the checkout summary (SRS V2 §L "Checkout Revalidation & Stale
 * Cart Protection": "Immediately before payment/order creation, the
 * server revalidates restaurant status, product availability, current
 * price, operating hours, pickup slot, capacity, preparation cutoff and
 * schedule feasibility... Browser cart values are never trusted for final
 * payment/order truth.").
 *
 * This is deliberately a SEPARATE pass from confirmPickupSchedule's
 * validation, run fresh, because time has passed since scheduling — a
 * product may have gone out of stock, a restaurant may have paused, or
 * another customer may have filled the slot in the meantime. Phase 3's
 * Razorpay checkout-initiation step must call this exact function (or its
 * direct successor) again, immediately before creating the Razorpay order
 * — not reuse a result computed even a few requests earlier.
 */
export async function getCheckoutPreview(groupId: string): Promise<CheckoutPreviewResult> {
  const profile = await requireRole("customer");
  const supabase = createServiceRoleSupabaseClient();

  const { data: group } = await supabase
    .from("multi_order_groups")
    .select("id, customer_id")
    .eq("id", groupId)
    .single();

  if (!group || group.customer_id !== profile.id) {
    return { valid: false, issues: ["This checkout session could not be found."] };
  }

  const { data: sequences } = await supabase
    .from("pickup_sequences")
    .select("restaurant_id, sequence_no, pickup_time, restaurants(id, name)")
    .eq("group_id", groupId)
    .order("sequence_no");

  if (!sequences || sequences.length === 0) {
    return { valid: false, issues: ["No pickup schedule found for this checkout."] };
  }

  const cartGroups = await getCurrentCartGrouped();
  const cartByRestaurant = new Map(cartGroups.map((g) => [g.restaurantId, g]));

  const issues: string[] = [];
  const restaurants: CheckoutRestaurantSummary[] = [];
  let grandTotalPaise = 0;

  for (const seq of sequences) {
    const restaurantMeta = (seq as any).restaurants;
    const cartGroup = cartByRestaurant.get(seq.restaurant_id);

    if (!cartGroup || cartGroup.items.length === 0) {
      issues.push(`Your cart no longer has items from ${restaurantMeta?.name ?? "a restaurant in your schedule"}.`);
      continue;
    }
    if (!cartGroup.orderable) {
      issues.push(`${cartGroup.restaurantName} isn't accepting orders right now.`);
      continue;
    }

    const unavailableItems = cartGroup.items.filter((i) => !i.available);
    if (unavailableItems.length > 0) {
      issues.push(
        `${cartGroup.restaurantName}: ${unavailableItems.map((i) => i.name).join(", ")} ${unavailableItems.length === 1 ? "is" : "are"} no longer available.`
      );
      continue;
    }

    const pickupTime = new Date(seq.pickup_time);
    const feasibility = await checkPickupFeasibility(seq.restaurant_id, pickupTime);
    if (!feasibility.feasible) {
      issues.push(`${cartGroup.restaurantName}: ${FEASIBILITY_MESSAGES[feasibility.reason]}`);
      continue;
    }

    const summary: CheckoutRestaurantSummary = {
      restaurantId: seq.restaurant_id,
      restaurantName: cartGroup.restaurantName,
      pickupTime: seq.pickup_time,
      sequenceNo: seq.sequence_no,
      items: cartGroup.items.map((i) => ({ name: i.name, pricePaise: i.pricePaise, quantity: i.quantity })),
      subtotalPaise: cartGroup.subtotalPaise,
    };

    restaurants.push(summary);
    grandTotalPaise += summary.subtotalPaise;
  }

  if (issues.length > 0) {
    return { valid: false, issues };
  }

  return { valid: true, groupId, restaurants, grandTotalPaise };
}
