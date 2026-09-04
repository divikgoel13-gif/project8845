"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Super-Admin catalog controls for one restaurant (SRS §6 "Menus", V2.6 §60
 * product/category visibility and ordering).
 *
 * These are deliberately the ONLY catalog mutations the admin console offers.
 * §60 gives the platform the ability to hide a product or a whole category and to
 * reorder them; it does not make the Super Admin a second editor of prices,
 * descriptions and stock, and adding that here would create two writers to the
 * same rows with no way to tell whose intent is current. A wrong price is a
 * conversation with the vendor, not an admin override.
 *
 * `is_visible` is a separate axis from `availability`:
 *
 *   availability -- the vendor saying "we are out of this right now".
 *   is_visible   -- the platform saying "this must not be listed at all".
 *
 * Collapsing them would mean a vendor could undo a platform decision by marking
 * an item back in stock, which is exactly what §60 visibility exists to prevent.
 * Neither flag ever touches an existing order: `order_items` carries its own name
 * and price snapshots (§11.5).
 */

const VisibilitySchema = z.object({
  restaurantId: z.string().uuid(),
  productId: z.string().uuid(),
  isVisible: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export async function setProductVisibility(input: z.input<typeof VisibilitySchema>) {
  const admin = await requireSuperAdmin();
  const parsed = VisibilitySchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("products")
    .select("id, restaurant_id, name, is_visible")
    .eq("id", parsed.productId)
    .maybeSingle();

  if (!before) return { ok: false as const, error: "Product not found." };
  // The restaurant id is re-checked against the row rather than trusted from the
  // form: the id in the URL decides which workspace the operator is in, and a
  // mismatch means the request did not come from the page it claims to (§17).
  if (before.restaurant_id !== parsed.restaurantId) {
    return { ok: false as const, error: "That product belongs to a different restaurant." };
  }

  const { error } = await supabase
    .from("products")
    .update({ is_visible: parsed.isVisible })
    .eq("id", parsed.productId);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: parsed.isVisible ? "product.made_visible" : "product.hidden",
    targetTable: "products",
    targetId: parsed.productId,
    restaurantId: parsed.restaurantId,
    before,
    after: { is_visible: parsed.isVisible },
    reason: parsed.reason ?? undefined,
  });

  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/products`);
  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/menu`);
  revalidatePath("/admin/menus");
  return { ok: true as const };
}

const CategoryVisibilitySchema = z.object({
  restaurantId: z.string().uuid(),
  categoryId: z.string().uuid(),
  isVisible: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Hiding a category hides the customer-facing SECTION, not the products in it.
 * The products keep their own `is_visible`, so re-showing the category restores
 * exactly what was there — cascading the flag down would silently overwrite
 * per-product decisions that cannot then be recovered.
 */
export async function setCategoryVisibility(input: z.input<typeof CategoryVisibilitySchema>) {
  const admin = await requireSuperAdmin();
  const parsed = CategoryVisibilitySchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("product_categories")
    .select("id, restaurant_id, name, is_visible")
    .eq("id", parsed.categoryId)
    .maybeSingle();

  if (!before) return { ok: false as const, error: "Category not found." };
  if (before.restaurant_id !== parsed.restaurantId) {
    return { ok: false as const, error: "That category belongs to a different restaurant." };
  }

  const { error } = await supabase
    .from("product_categories")
    .update({ is_visible: parsed.isVisible, updated_at: new Date().toISOString() })
    .eq("id", parsed.categoryId);
  if (error) return { ok: false as const, error: error.message };

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: parsed.isVisible ? "category.made_visible" : "category.hidden",
    targetTable: "product_categories",
    targetId: parsed.categoryId,
    restaurantId: parsed.restaurantId,
    before,
    after: { is_visible: parsed.isVisible },
    reason: parsed.reason ?? undefined,
  });

  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/menu`);
  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/products`);
  revalidatePath("/admin/menus");
  return { ok: true as const };
}

const SortSchema = z.object({
  restaurantId: z.string().uuid(),
  /** Ids in their new display order. Index becomes `sort_order`. */
  ids: z.array(z.string().uuid()).min(1).max(500),
  kind: z.enum(["product", "category"]),
});

/**
 * Reordering writes an explicit `sort_order` for EVERY id in the list rather than
 * swapping two rows. §60 requires the order to be deterministic, and the legacy
 * rows all default to `sort_order = 0` — a swap-based implementation on a set of
 * zeroes reorders nothing visible while appearing to work.
 *
 * Readers order by `(sort_order, name)`, so ties still resolve stably.
 */
export async function reorderCatalog(input: z.input<typeof SortSchema>) {
  const admin = await requireSuperAdmin();
  const parsed = SortSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();
  const table = parsed.kind === "product" ? "products" : "product_categories";

  const { data: owned } = await supabase.from(table).select("id").eq("restaurant_id", parsed.restaurantId);
  const allowed = new Set(((owned ?? []) as { id: string }[]).map((r) => r.id));
  if (parsed.ids.some((id) => !allowed.has(id))) {
    return { ok: false as const, error: "That list contains rows from a different restaurant." };
  }

  // Sequential rather than a single upsert: an upsert would need every NOT NULL
  // column of each row, and reordering must not be a path that can blank a name.
  for (const [index, id] of parsed.ids.entries()) {
    const { error } = await supabase.from(table).update({ sort_order: index }).eq("id", id);
    if (error) return { ok: false as const, error: error.message };
  }

  await recordAuditEvent({
    actorId: admin.id,
    actorRole: admin.role,
    action: `${parsed.kind}.reordered`,
    targetTable: table,
    restaurantId: parsed.restaurantId,
    after: { order: parsed.ids },
  });

  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/menu`);
  revalidatePath(`/admin/restaurants/${parsed.restaurantId}/products`);
  revalidatePath("/admin/menus");
  return { ok: true as const };
}
