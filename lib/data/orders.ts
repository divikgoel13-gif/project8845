import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type OrderGroupSummary = {
  groupId: string;
  createdAt: string;
  orders: {
    orderId: string;
    restaurantName: string;
    status: string;
    pickupTime: string | null;
  }[];
};

/**
 * Customer order history (SRS Phase 3 deliverable: "Customer order
 * history and order detail"). RLS-bound client — `orders_select_scoped`
 * (SRS §17) already restricts this to the caller's own orders, so there's
 * no need for the service-role client here.
 */
export async function listCustomerOrderGroups(customerId: string): Promise<OrderGroupSummary[]> {
  const supabase = createServerSupabaseClient();

  const { data: groups } = await supabase
    .from("multi_order_groups")
    .select("id, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false });

  if (!groups || groups.length === 0) return [];

  const { data: orders } = await supabase
    .from("orders")
    .select("id, group_id, status, pickup_time, restaurants(name)")
    .in(
      "group_id",
      groups.map((g) => g.id)
    )
    .neq("status", "payment_pending") // don't show abandoned/never-paid attempts in history
    .order("pickup_time");

  const byGroup = new Map<string, OrderGroupSummary["orders"]>();
  for (const o of orders ?? []) {
    const restaurantName = (o as any).restaurants?.name ?? "Restaurant";
    const list = byGroup.get(o.group_id!) ?? [];
    list.push({ orderId: o.id, restaurantName, status: o.status, pickupTime: o.pickup_time });
    byGroup.set(o.group_id!, list);
  }

  return groups
    .filter((g) => byGroup.has(g.id))
    .map((g) => ({ groupId: g.id, createdAt: g.created_at, orders: byGroup.get(g.id)! }));
}

export type OrderGroupDetail = {
  groupId: string;
  qrToken: string;
  orders: {
    orderId: string;
    restaurantId: string;
    restaurantName: string;
    status: string;
    pickupTime: string | null;
    /**
     * When staff (or the auto-ready job) marked this order ready, and when it
     * was actually collected. Needed by the V2.6 §59 "food not ready yet"
     * prompt, which fires on `ready_for_pickup` + uncollected + elapsed
     * threshold. Read from the order rather than inferred from `pickup_time`,
     * because §59 measures from the ready moment, not from the promised slot.
     */
    readyAt: string | null;
    collectedAt: string | null;
    subtotalPaise: number;
    items: { name: string; pricePaise: number; quantity: number }[];
    hasRating: boolean;
  }[];
};

export async function getOrderGroupDetail(groupId: string, customerId: string): Promise<OrderGroupDetail | null> {
  const supabase = createServerSupabaseClient();

  const { data: group } = await supabase
    .from("multi_order_groups")
    .select("id, qr_token, customer_id")
    .eq("id", groupId)
    .single();

  if (!group || group.customer_id !== customerId) return null;

  const { data: orders } = await supabase
    .from("orders")
    .select("id, restaurant_id, status, pickup_time, ready_at, collected_at, subtotal_paise, restaurants(name)")
    .eq("group_id", groupId)
    .neq("status", "payment_pending")
    .order("pickup_time");

  if (!orders || orders.length === 0) return null;

  const orderIds = orders.map((o) => o.id);

  const [{ data: items }, { data: ratings }] = await Promise.all([
    supabase.from("order_items").select("order_id, name_snapshot, price_snapshot_paise, quantity").in("order_id", orderIds),
    supabase.from("ratings").select("order_id").in("order_id", orderIds),
  ]);

  const ratedOrderIds = new Set((ratings ?? []).map((r) => r.order_id));

  return {
    groupId: group.id,
    qrToken: group.qr_token,
    orders: orders.map((o) => ({
      orderId: o.id,
      restaurantId: o.restaurant_id,
      restaurantName: (o as any).restaurants?.name ?? "Restaurant",
      status: o.status,
      pickupTime: o.pickup_time,
      readyAt: o.ready_at,
      collectedAt: o.collected_at,
      subtotalPaise: o.subtotal_paise,
      items: (items ?? [])
        .filter((i) => i.order_id === o.id)
        .map((i) => ({ name: i.name_snapshot, pricePaise: i.price_snapshot_paise, quantity: i.quantity })),
      hasRating: ratedOrderIds.has(o.id),
    })),
  };
}
