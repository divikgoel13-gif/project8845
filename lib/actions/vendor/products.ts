"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRestaurantScope } from "@/lib/auth/guards";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/lib/audit/log";

/**
 * Vendor Admin product/category management (SRS Phase 4, §10 Products row:
 * "Add/delete/edit product. Price required. Image/description/cook time
 * optional. Out-of-stock persists until re-enabled."). Every action here
 * is Vendor-Admin-only (staff have zero product access per SRS §11: "No
 * product, price, payment, analytics, grievance or settings access") and
 * restaurant-scoped via requireRestaurantScope — never trust a
 * restaurantId from the client without it (SRS §17).
 *
 * "Delete" is implemented as archive (products.archived_at), not a hard
 * DELETE — a hard delete would break historical order_items, which
 * intentionally snapshot name/price at purchase time specifically so a
 * later product edit or removal never rewrites history (SRS §1.1).
 * Categories may be hard-deleted only when empty of active products
 * (products.category_id ON DELETE SET NULL would otherwise silently
 * orphan menu structure).
 */

const CreateCategorySchema = z.object({
  restaurantId: z.string().uuid(),
  name: z.string().trim().min(1, "Category name is required.").max(100),
});

export async function createCategory(input: { restaurantId: string; name: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = CreateCategorySchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: existing } = await supabase
    .from("product_categories")
    .select("sort_order")
    .eq("restaurant_id", parsed.restaurantId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: category, error } = await supabase
    .from("product_categories")
    .insert({
      restaurant_id: parsed.restaurantId,
      name: parsed.name,
      sort_order: (existing?.sort_order ?? -1) + 1,
    })
    .select("id, name, sort_order, is_visible")
    .single();

  if (error || !category) throw new Error(error?.message ?? "Could not create category.");

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "product_category.created",
    targetTable: "product_categories",
    targetId: category.id,
    restaurantId: parsed.restaurantId,
    after: category,
  });

  revalidatePath("/vendor/products");
  return category;
}

const RenameCategorySchema = z.object({
  restaurantId: z.string().uuid(),
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1, "Category name is required.").max(100),
});

export async function renameCategory(input: { restaurantId: string; categoryId: string; name: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = RenameCategorySchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("product_categories")
    .select("id, name, restaurant_id")
    .eq("id", parsed.categoryId)
    .single();

  if (!before || before.restaurant_id !== parsed.restaurantId) {
    throw new Error("Category not found for this restaurant.");
  }

  const { error } = await supabase
    .from("product_categories")
    .update({ name: parsed.name })
    .eq("id", parsed.categoryId);

  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "product_category.renamed",
    targetTable: "product_categories",
    targetId: parsed.categoryId,
    restaurantId: parsed.restaurantId,
    before: { name: before.name },
    after: { name: parsed.name },
  });

  revalidatePath("/vendor/products");
}

const ProductInputSchema = z.object({
  restaurantId: z.string().uuid(),
  categoryId: z.string().uuid().nullable(),
  name: z.string().trim().min(1, "Product name is required.").max(150),
  description: z.string().trim().max(2000).nullable(),
  pricePaise: z.number().int().min(0, "Price cannot be negative."), // required — SRS §10
  cookTimeMinutes: z.number().int().min(0).max(240).nullable(),
  imagePath: z.string().trim().max(500).nullable(),
  inventoryMode: z.enum(["boolean", "quantity"]).default("boolean"),
  stockQuantity: z.number().int().min(0).nullable(),
});

export async function createProduct(input: z.infer<typeof ProductInputSchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = ProductInputSchema.parse(input);

  if (parsed.inventoryMode === "quantity" && parsed.stockQuantity === null) {
    throw new Error("Stock quantity is required when quantity-based inventory is enabled.");
  }

  const supabase = createServiceRoleSupabaseClient();

  if (parsed.categoryId) {
    const { data: category } = await supabase
      .from("product_categories")
      .select("restaurant_id")
      .eq("id", parsed.categoryId)
      .single();
    if (!category || category.restaurant_id !== parsed.restaurantId) {
      throw new Error("That category does not belong to this restaurant.");
    }
  }

  // §60 requires display order to be deterministic and persistent, so a new
  // product needs a real position rather than the column default — every
  // product created with sort_order 0 would tie, and ties are resolved by name,
  // which silently alphabetises a menu the vendor never ordered. Appending
  // after the current maximum WITHIN THE CATEGORY matches how the customer menu
  // groups before ordering. Two simultaneous creates can still collide on one
  // number; the `(sort_order, name)` read order keeps that stable rather than
  // flickering, and a reorder resolves it permanently.
  const categoryFilter = supabase
    .from("products")
    .select("sort_order")
    .eq("restaurant_id", parsed.restaurantId);
  const { data: last } = await (parsed.categoryId
    ? categoryFilter.eq("category_id", parsed.categoryId)
    : categoryFilter.is("category_id", null))
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: product, error } = await supabase
    .from("products")
    .insert({
      restaurant_id: parsed.restaurantId,
      category_id: parsed.categoryId,
      name: parsed.name,
      description: parsed.description,
      price_paise: parsed.pricePaise,
      cook_time_minutes: parsed.cookTimeMinutes,
      image_path: parsed.imagePath,
      inventory_mode: parsed.inventoryMode,
      stock_quantity: parsed.inventoryMode === "quantity" ? parsed.stockQuantity : null,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select("id, name, price_paise, sort_order, is_visible")
    .single();

  if (error || !product) throw new Error(error?.message ?? "Could not create product.");

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "product.created",
    targetTable: "products",
    targetId: product.id,
    restaurantId: parsed.restaurantId,
    after: { name: product.name, price_paise: product.price_paise },
  });

  revalidatePath("/vendor/products");
  return product;
}

const UpdateProductSchema = ProductInputSchema.extend({
  productId: z.string().uuid(),
});

export async function updateProduct(input: z.infer<typeof UpdateProductSchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = UpdateProductSchema.parse(input);

  if (parsed.inventoryMode === "quantity" && parsed.stockQuantity === null) {
    throw new Error("Stock quantity is required when quantity-based inventory is enabled.");
  }

  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("products")
    .select("restaurant_id, name, price_paise, description, cook_time_minutes, image_path, category_id, inventory_mode, stock_quantity")
    .eq("id", parsed.productId)
    .single();

  if (!before || before.restaurant_id !== parsed.restaurantId) {
    throw new Error("Product not found for this restaurant.");
  }

  if (parsed.categoryId) {
    const { data: category } = await supabase
      .from("product_categories")
      .select("restaurant_id")
      .eq("id", parsed.categoryId)
      .single();
    if (!category || category.restaurant_id !== parsed.restaurantId) {
      throw new Error("That category does not belong to this restaurant.");
    }
  }

  const after = {
    name: parsed.name,
    description: parsed.description,
    price_paise: parsed.pricePaise,
    cook_time_minutes: parsed.cookTimeMinutes,
    image_path: parsed.imagePath,
    category_id: parsed.categoryId,
    inventory_mode: parsed.inventoryMode,
    stock_quantity: parsed.inventoryMode === "quantity" ? parsed.stockQuantity : null,
  };

  const { error } = await supabase.from("products").update(after).eq("id", parsed.productId);
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "product.updated",
    targetTable: "products",
    targetId: parsed.productId,
    restaurantId: parsed.restaurantId,
    before,
    after,
  });

  revalidatePath("/vendor/products");
}

const SetAvailabilitySchema = z.object({
  restaurantId: z.string().uuid(),
  productId: z.string().uuid(),
  availability: z.enum(["available", "out_of_stock"]),
});

/**
 * Out-of-stock toggle. Persists until explicitly re-enabled (SRS §10:
 * "Out-of-stock persists until re-enabled") — this is just a plain column
 * write, deliberately with no auto-expiry logic anywhere, so that
 * guarantee holds by construction rather than by a background job someone
 * has to remember to keep working.
 */
export async function setProductAvailability(input: {
  restaurantId: string;
  productId: string;
  availability: "available" | "out_of_stock";
}) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = SetAvailabilitySchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("products")
    .select("restaurant_id, availability")
    .eq("id", parsed.productId)
    .single();

  if (!before || before.restaurant_id !== parsed.restaurantId) {
    throw new Error("Product not found for this restaurant.");
  }

  const { error } = await supabase
    .from("products")
    .update({ availability: parsed.availability })
    .eq("id", parsed.productId);

  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "product.availability_changed",
    targetTable: "products",
    targetId: parsed.productId,
    restaurantId: parsed.restaurantId,
    before: { availability: before.availability },
    after: { availability: parsed.availability },
  });

  revalidatePath("/vendor/products");
}

const ArchiveProductSchema = z.object({
  restaurantId: z.string().uuid(),
  productId: z.string().uuid(),
});

export async function archiveProduct(input: { restaurantId: string; productId: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = ArchiveProductSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("products")
    .select("restaurant_id, name, archived_at")
    .eq("id", parsed.productId)
    .single();

  if (!before || before.restaurant_id !== parsed.restaurantId) {
    throw new Error("Product not found for this restaurant.");
  }
  if (before.archived_at) return; // already archived — idempotent

  const { error } = await supabase
    .from("products")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.productId);

  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "product.archived",
    targetTable: "products",
    targetId: parsed.productId,
    restaurantId: parsed.restaurantId,
    before: { name: before.name, archived_at: null },
  });

  revalidatePath("/vendor/products");
}

export async function restoreProduct(input: { restaurantId: string; productId: string }) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = ArchiveProductSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("products")
    .select("restaurant_id, name, archived_at")
    .eq("id", parsed.productId)
    .single();

  if (!before || before.restaurant_id !== parsed.restaurantId) {
    throw new Error("Product not found for this restaurant.");
  }

  const { error } = await supabase.from("products").update({ archived_at: null }).eq("id", parsed.productId);
  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "product.restored",
    targetTable: "products",
    targetId: parsed.productId,
    restaurantId: parsed.restaurantId,
    before: { archived_at: before.archived_at },
    after: { archived_at: null },
  });

  revalidatePath("/vendor/products");
}

// ─────────────────────────────────────────────────────────────────────────
// SRS V2.6 §60 — VISIBILITY AND DISPLAY ORDER
// ─────────────────────────────────────────────────────────────────────────

const SetVisibilitySchema = z.object({
  restaurantId: z.string().uuid(),
  productId: z.string().uuid(),
  isVisible: z.boolean(),
});

/**
 * SRS V2.6 §60: "Product active/archived, visibility and stock/availability are
 * distinct concepts where required."
 *
 * This is the third of the three, and it is genuinely not either of the others.
 * Archiving says the restaurant no longer sells the dish. Marking it out of
 * stock says they sell it but not today, which is information a customer wants.
 * Hiding says: do not show this at all right now — a seasonal item out of
 * season, a dish being repriced, a category mid-reorganisation — while keeping
 * the row, its history and its stock figures intact for when it comes back.
 *
 * Deliberately does NOT touch `availability`. Restoring a hidden product must
 * bring back exactly the stock state it had, otherwise hiding a sold-out item
 * for a week silently re-advertises it as available.
 */
export async function setProductVisibility(input: z.infer<typeof SetVisibilitySchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = SetVisibilitySchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("products")
    .select("restaurant_id, name, is_visible, archived_at")
    .eq("id", parsed.productId)
    .single();

  if (!before || before.restaurant_id !== parsed.restaurantId) {
    throw new Error("Product not found for this restaurant.");
  }
  // An archived product is already off the menu; letting it be "shown" would
  // create a state the customer menu reader ignores, which reads as a bug.
  if (before.archived_at && parsed.isVisible) {
    throw new Error("Restore this product before making it visible again.");
  }
  if (before.is_visible === parsed.isVisible) return;

  const { error } = await supabase
    .from("products")
    .update({ is_visible: parsed.isVisible })
    .eq("id", parsed.productId);

  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "product.visibility_changed",
    targetTable: "products",
    targetId: parsed.productId,
    restaurantId: parsed.restaurantId,
    before: { name: before.name, is_visible: before.is_visible },
    after: { is_visible: parsed.isVisible },
  });

  revalidatePath("/vendor/products");
}

const SetCategoryVisibilitySchema = z.object({
  restaurantId: z.string().uuid(),
  categoryId: z.string().uuid(),
  isVisible: z.boolean(),
});

/** §60 visibility at the category level — hides the section and its products. */
export async function setCategoryVisibility(input: z.infer<typeof SetCategoryVisibilitySchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = SetCategoryVisibilitySchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: before } = await supabase
    .from("product_categories")
    .select("restaurant_id, name, is_visible")
    .eq("id", parsed.categoryId)
    .single();

  if (!before || before.restaurant_id !== parsed.restaurantId) {
    throw new Error("Category not found for this restaurant.");
  }
  if (before.is_visible === parsed.isVisible) return;

  const { error } = await supabase
    .from("product_categories")
    .update({ is_visible: parsed.isVisible })
    .eq("id", parsed.categoryId);

  if (error) throw new Error(error.message);

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "product_category.visibility_changed",
    targetTable: "product_categories",
    targetId: parsed.categoryId,
    restaurantId: parsed.restaurantId,
    before: { name: before.name, is_visible: before.is_visible },
    after: { is_visible: parsed.isVisible },
  });

  revalidatePath("/vendor/products");
}

const ReorderSchema = z.object({
  restaurantId: z.string().uuid(),
  /**
   * The complete ordered list of ids for the group being reordered. Sending the
   * whole list rather than one "move up" instruction is what makes the write
   * idempotent and free of gaps: sort_order is re-assigned as 0..n-1 from the
   * array index, so two admins reordering concurrently produce one coherent
   * order (the later write wins outright) instead of two interleaved swaps that
   * leave duplicate positions.
   */
  orderedIds: z.array(z.string().uuid()).min(1).max(500),
});

/**
 * SRS V2.6 §60: "Vendor Admin/Super Admin can control product display order
 * within categories" and "category/product ordering is deterministic and
 * persists."
 *
 * Persistence is `sort_order`; determinism needs both this write AND the
 * `(sort_order, name)` ordering in lib/data/products.ts, because sort_order on
 * its own leaves ties to the query planner. Callers pass the products of ONE
 * category — the customer menu groups by category before ordering, so a global
 * renumber would be meaningless.
 */
export async function reorderProducts(input: z.infer<typeof ReorderSchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = ReorderSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  // Verify every id belongs to this restaurant before writing any of them. A
  // client that slipped another restaurant's product id into the array would
  // otherwise have its row renumbered — a cross-tenant write through an
  // endpoint that looks purely cosmetic.
  const { data: owned } = await supabase
    .from("products")
    .select("id")
    .eq("restaurant_id", parsed.restaurantId)
    .in("id", parsed.orderedIds);

  const ownedIds = new Set((owned ?? []).map((p) => p.id));
  if (ownedIds.size !== parsed.orderedIds.length) {
    throw new Error("One or more products do not belong to this restaurant.");
  }

  // Sequential single-row updates rather than one upsert: an upsert would need
  // every NOT NULL column present, and re-sending name/price from the client is
  // exactly how a reorder turns into an unintended price change.
  for (const [index, id] of parsed.orderedIds.entries()) {
    const { error } = await supabase
      .from("products")
      .update({ sort_order: index })
      .eq("id", id)
      .eq("restaurant_id", parsed.restaurantId);
    if (error) throw new Error(error.message);
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "product.reordered",
    targetTable: "products",
    restaurantId: parsed.restaurantId,
    after: { orderedIds: parsed.orderedIds },
  });

  revalidatePath("/vendor/products");
}

/** §60 category ordering. Same whole-list contract as reorderProducts. */
export async function reorderCategories(input: z.infer<typeof ReorderSchema>) {
  const profile = await requireRestaurantScope(input.restaurantId, ["vendor_admin"]);
  const parsed = ReorderSchema.parse(input);
  const supabase = createServiceRoleSupabaseClient();

  const { data: owned } = await supabase
    .from("product_categories")
    .select("id")
    .eq("restaurant_id", parsed.restaurantId)
    .in("id", parsed.orderedIds);

  if ((owned ?? []).length !== parsed.orderedIds.length) {
    throw new Error("One or more categories do not belong to this restaurant.");
  }

  for (const [index, id] of parsed.orderedIds.entries()) {
    const { error } = await supabase
      .from("product_categories")
      .update({ sort_order: index })
      .eq("id", id)
      .eq("restaurant_id", parsed.restaurantId);
    if (error) throw new Error(error.message);
  }

  await recordAuditEvent({
    actorId: profile.id,
    actorRole: "vendor_admin",
    action: "product_category.reordered",
    targetTable: "product_categories",
    restaurantId: parsed.restaurantId,
    after: { orderedIds: parsed.orderedIds },
  });

  revalidatePath("/vendor/products");
}
