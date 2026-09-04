"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { createServerSupabaseClient, createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { isRestaurantOrderable } from "@/lib/data/restaurants";

/**
 * Cart Server Actions (SRS Phase 2: "Cart with multiple restaurants...
 * Restaurant-specific cart grouping"). Every action re-validates the
 * product against the database — quantity, availability, and restaurant
 * orderability are all checked server-side. The client never gets to
 * assert "this product costs X" or "this restaurant is open" — those are
 * always read fresh here and again at checkout revalidation (Phase 3,
 * SRS V2 §L).
 */

async function getOrCreateCart(customerId: string) {
  const supabase = createServerSupabaseClient();

  const { data: existing } = await supabase
    .from("carts")
    .select("id")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("carts")
    .insert({ customer_id: customerId })
    .select("id")
    .single();

  if (error || !created) throw new Error("Could not create cart.");
  return created.id;
}

const AddToCartSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(20),
});

export async function addToCart(input: { productId: string; quantity: number }) {
  const profile = await requireRole("customer");
  const parsed = AddToCartSchema.parse(input);

  // Service-role read here: we need the product's restaurant/status
  // regardless of RLS's public-select shape, and we're about to make an
  // authorization DECISION based on it (is it orderable), not just
  // displaying it — see lib/supabase/server.ts guidance on when this is
  // warranted.
  const supabase = createServiceRoleSupabaseClient();
  const { data: product } = await supabase
    .from("products")
    .select("id, restaurant_id, availability, inventory_mode, stock_quantity, archived_at, is_visible")
    .eq("id", parsed.productId)
    .single();

  // SRS V2.6 §60 keeps these three as separate concepts, and they produce
  // separate messages here. Archived and hidden both mean "not on the menu", so
  // they get the same wording — telling a customer a product is deliberately
  // hidden would leak a vendor's merchandising decision — while out of stock
  // stays distinct because it is temporary and worth coming back for.
  if (!product || product.archived_at || !product.is_visible) {
    throw new Error("This product is no longer available.");
  }
  if (
    product.availability === "out_of_stock" ||
    (product.inventory_mode === "quantity" && (product.stock_quantity ?? 0) <= 0)
  ) {
    throw new Error("This product is currently out of stock.");
  }

  const { data: restaurant } = await supabase
    .from("restaurants")
    .select("status, paused_until")
    .eq("id", product.restaurant_id)
    .single();

  if (!restaurant || !isRestaurantOrderable(restaurant)) {
    throw new Error("This restaurant isn't accepting orders right now.");
  }

  const cartId = await getOrCreateCart(profile.id);
  const rls = createServerSupabaseClient();

  const { data: existingItem } = await rls
    .from("cart_items")
    .select("id, quantity")
    .eq("cart_id", cartId)
    .eq("product_id", parsed.productId)
    .maybeSingle();

  if (existingItem) {
    const { error } = await rls
      .from("cart_items")
      .update({ quantity: existingItem.quantity + parsed.quantity })
      .eq("id", existingItem.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await rls
      .from("cart_items")
      .insert({ cart_id: cartId, product_id: parsed.productId, quantity: parsed.quantity });
    // 23505 = unique_violation on cart_items(cart_id, product_id)
    // (0023_phase10_security_audit_fixes.sql, PHASE_10_SECURITY_AUDIT §10.5):
    // a concurrent addToCart call for the same product won the race between
    // our read above and this insert. Fall back to incrementing the row
    // that now exists instead of surfacing a spurious error to the user.
    if (error?.code === "23505") {
      const { data: raced } = await rls
        .from("cart_items")
        .select("id, quantity")
        .eq("cart_id", cartId)
        .eq("product_id", parsed.productId)
        .single();
      if (!raced) throw new Error(error.message);
      const { error: updateError } = await rls
        .from("cart_items")
        .update({ quantity: raced.quantity + parsed.quantity })
        .eq("id", raced.id);
      if (updateError) throw new Error(updateError.message);
    } else if (error) {
      throw new Error(error.message);
    }
  }

  revalidatePath("/cart");
}

const UpdateQuantitySchema = z.object({
  cartItemId: z.string().uuid(),
  quantity: z.number().int().min(0).max(20), // 0 = remove
});

export async function updateCartItemQuantity(input: { cartItemId: string; quantity: number }) {
  await requireRole("customer");
  const parsed = UpdateQuantitySchema.parse(input);
  const supabase = createServerSupabaseClient(); // RLS scopes this to the caller's own cart

  if (parsed.quantity === 0) {
    const { error } = await supabase.from("cart_items").delete().eq("id", parsed.cartItemId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("cart_items")
      .update({ quantity: parsed.quantity })
      .eq("id", parsed.cartItemId);
    if (error) throw new Error(error.message);
  }

  revalidatePath("/cart");
}

export async function removeCartItem(cartItemId: string) {
  await requireRole("customer");
  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("cart_items").delete().eq("id", cartItemId);
  if (error) throw new Error(error.message);
  revalidatePath("/cart");
}

export type CartGroup = {
  restaurantId: string;
  restaurantName: string;
  restaurantSlug: string;
  orderable: boolean;
  items: {
    cartItemId: string;
    productId: string;
    name: string;
    pricePaise: number;
    quantity: number;
    available: boolean;
  }[];
  subtotalPaise: number;
};

/**
 * Reads the current customer's cart, grouped by restaurant (SRS §9:
 * "System partitions cart into restaurant orders"). Prices, availability,
 * and orderability are all re-read from the database at render time — a
 * price shown in the cart is never the price the item was added at, it's
 * the CURRENT price, exactly as SRS §17 requires.
 */
export async function getCurrentCartGrouped(): Promise<CartGroup[]> {
  const profile = await requireRole("customer");
  const supabase = createServerSupabaseClient();

  const { data: cart } = await supabase
    .from("carts")
    .select("id")
    .eq("customer_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cart) return [];

  const { data: items } = await supabase
    .from("cart_items")
    .select(
      "id, product_id, quantity, products(id, name, price_paise, availability, inventory_mode, stock_quantity, archived_at, is_visible, restaurant_id, restaurants(id, name, slug, status, paused_until))"
    )
    .eq("cart_id", cart.id);

  const groups = new Map<string, CartGroup>();

  for (const item of items ?? []) {
    // Supabase's typed join shape varies by generated-types version; this
    // reads defensively rather than assuming a specific nested shape —
    // regenerate types (see docs/KNOWN_ISSUES.md) and tighten this once a
    // live project exists.
    const product = (item as any).products;
    const restaurant = product?.restaurants;
    if (!product || !restaurant) continue;

    // A product hidden from the menu after it was added to a cart (V2.6 §60
    // is_visible) is treated exactly as archived: the line stays visible so the
    // customer can see what has changed, but it is not purchasable.
    const available =
      !product.archived_at &&
      product.is_visible !== false &&
      product.availability === "available" &&
      !(product.inventory_mode === "quantity" && (product.stock_quantity ?? 0) <= 0);

    if (!groups.has(restaurant.id)) {
      groups.set(restaurant.id, {
        restaurantId: restaurant.id,
        restaurantName: restaurant.name,
        restaurantSlug: restaurant.slug,
        orderable: isRestaurantOrderable(restaurant),
        items: [],
        subtotalPaise: 0,
      });
    }

    const group = groups.get(restaurant.id)!;
    group.items.push({
      cartItemId: item.id,
      productId: product.id,
      name: product.name,
      pricePaise: product.price_paise,
      quantity: item.quantity,
      available,
    });
    if (available) group.subtotalPaise += product.price_paise * item.quantity;
  }

  return Array.from(groups.values());
}
