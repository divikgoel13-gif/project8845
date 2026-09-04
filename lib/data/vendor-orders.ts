import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

export type VendorOrderStatus = Enums<"order_status">;

export type VendorOrderSummary = {
  orderId: string;
  status: VendorOrderStatus;
  pickupTime: string | null;
  subtotalPaise: number;
  createdAt: string;
  customerName: string | null;
  customerPhone: string | null;
  itemCount: number;
};

export type VendorOrderFilters = {
  status?: VendorOrderStatus | "all";
  /** Matches against customer name or phone — SRS §10 Orders row: "search". */
  search?: string;
  pickupDate?: string; // YYYY-MM-DD, local to the restaurant's pickup schedule
};

const ACTIVE_STATUSES: VendorOrderStatus[] = [
  "paid",
  "scheduled",
  "preparing",
  "ready_for_pickup",
];

/**
 * Vendor Admin / Staff order list (SRS Phase 4, §10 Orders row: "Live
 * orders queue... status filters, search, date range"). RLS-bound client
 * — `orders_select_scoped` already restricts results to restaurants the
 * caller has active scope over (SRS §17), and the restaurantId itself is
 * validated by the caller via requireRestaurantScope before this is ever
 * invoked, so a second explicit .eq("restaurant_id", ...) here is
 * defense-in-depth, not the only thing standing between this query and
 * another restaurant's orders.
 */
export async function listRestaurantOrders(
  restaurantId: string,
  filters: VendorOrderFilters = {}
): Promise<VendorOrderSummary[]> {
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("orders")
    // Disambiguated embed: `orders` has TWO foreign keys to `profiles`
    // (customer_id and cancelled_by), so a plain `profiles(...)` embed is
    // ambiguous to PostgREST and errors at request time. Naming the exact
    // constraint is required, not optional, here.
    .select(
      "id, status, pickup_time, subtotal_paise, created_at, customer_id, profiles!orders_customer_id_fkey(name, phone), order_items(id)"
    )
    .eq("restaurant_id", restaurantId)
    .neq("status", "payment_pending") // never-completed checkouts aren't "orders" to a vendor yet
    .order("pickup_time", { ascending: true, nullsFirst: false })
    .limit(200);

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.pickupDate) {
    const start = `${filters.pickupDate}T00:00:00.000Z`;
    const end = `${filters.pickupDate}T23:59:59.999Z`;
    query = query.gte("pickup_time", start).lte("pickup_time", end);
  }

  const { data: orders, error } = await query;
  if (error || !orders) return [];

  const search = filters.search?.trim().toLowerCase();

  return orders
    .map((o) => {
      const customer = (o as unknown as { profiles: { name: string | null; phone: string | null } | null }).profiles;
      const items = (o as unknown as { order_items: { id: string }[] }).order_items;
      return {
        orderId: o.id,
        status: o.status,
        pickupTime: o.pickup_time,
        subtotalPaise: o.subtotal_paise,
        createdAt: o.created_at,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        itemCount: items?.length ?? 0,
      };
    })
    .filter((o) => {
      if (!search) return true;
      return (o.customerName?.toLowerCase().includes(search) ?? false) || (o.customerPhone?.includes(search) ?? false);
    });
}

export async function countActiveOrders(restaurantId: string): Promise<number> {
  const supabase = createServerSupabaseClient();
  const { count } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .in("status", ACTIVE_STATUSES);
  return count ?? 0;
}
