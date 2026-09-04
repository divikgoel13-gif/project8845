import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type ProductListItem = {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price_paise: number;
  image_path: string | null;
  cook_time_minutes: number | null;
  availability: "available" | "out_of_stock";
  inventory_mode: "boolean" | "quantity";
  stock_quantity: number | null;
};

export type CategoryWithProducts = {
  id: string;
  name: string;
  sort_order: number;
  products: ProductListItem[];
};

/**
 * Menu for one restaurant, grouped by category (SRS §9 Discovery:
 * "View product image, description, price and availability"). A product
 * with inventory_mode = 'quantity' and stock_quantity = 0 is presented as
 * out_of_stock even though its `availability` column may still say
 * 'available' — quantity reaching zero implies unavailability
 * (SRS V2 §M) without requiring every stock-decrement code path to also
 * remember to flip the availability column.
 *
 * Three separate filters apply here, which SRS V2.6 §60 requires to stay
 * distinct concepts:
 *
 *   archived_at is null   -- the product still exists in the catalogue
 *   is_visible = true     -- it is meant to appear on the menu right now
 *   availability          -- it is shown, but marked buyable or not
 *
 * The first two REMOVE the product; the third only changes how it renders. That
 * is the difference §60 is asking for: an out-of-stock dish still tells the
 * customer this restaurant sells it, a hidden dish says nothing at all.
 *
 * Ordering is `(sort_order, name)`, never `sort_order` alone. §60 requires
 * ordering to be "deterministic and persistent", and two products sharing a
 * sort_order come back in whatever order the planner picked that day —
 * a menu that reshuffles between page loads. idx_products_menu_order (0021)
 * matches this exact ordering.
 */
export async function getRestaurantMenu(restaurantId: string): Promise<CategoryWithProducts[]> {
  const supabase = createServerSupabaseClient();

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase
      .from("product_categories")
      .select("id, name, sort_order")
      .eq("restaurant_id", restaurantId)
      .eq("is_visible", true)
      .order("sort_order")
      .order("name"),
    supabase
      .from("products")
      .select(
        "id, category_id, name, description, price_paise, image_path, cook_time_minutes, availability, inventory_mode, stock_quantity"
      )
      .eq("restaurant_id", restaurantId)
      .is("archived_at", null)
      .eq("is_visible", true)
      .order("sort_order")
      .order("name"),
  ]);

  const byCategory = new Map<string | null, ProductListItem[]>();
  for (const p of products ?? []) {
    const key = p.category_id;
    const effective: ProductListItem = {
      ...p,
      availability:
        p.inventory_mode === "quantity" && (p.stock_quantity ?? 0) <= 0
          ? "out_of_stock"
          : p.availability,
    };
    byCategory.set(key, [...(byCategory.get(key) ?? []), effective]);
  }

  const grouped: CategoryWithProducts[] = (categories ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    sort_order: c.sort_order,
    products: byCategory.get(c.id) ?? [],
  }));

  const uncategorized = byCategory.get(null) ?? [];
  if (uncategorized.length > 0) {
    grouped.push({ id: "uncategorized", name: "More", sort_order: Number.MAX_SAFE_INTEGER, products: uncategorized });
  }

  return grouped;
}

export async function getProductById(productId: string) {
  const supabase = createServerSupabaseClient();
  const { data } = await supabase
    .from("products")
    .select(
      "id, restaurant_id, name, price_paise, availability, inventory_mode, stock_quantity, archived_at, is_visible"
    )
    .eq("id", productId)
    .single();
  return data;
}

export type VendorProductListItem = ProductListItem & {
  archived_at: string | null;
  is_visible: boolean;
  sort_order: number;
};

/**
 * Vendor Admin's own view of their product list (SRS Phase 4 §10
 * Products row: "Add/delete/edit product"). Unlike getRestaurantMenu
 * (the customer-facing read), this deliberately INCLUDES archived
 * products — a Vendor Admin needs to see what they've archived in order
 * to restore it, since "delete" here is a soft archive, not a hard
 * DELETE (see lib/actions/vendor/products.ts for why).
 *
 * It also includes hidden products and `sort_order`, because §60 gives Vendor
 * Admin and Super Admin control over visibility and display order — controls
 * they cannot operate on rows this reader has filtered out.
 */
export async function getRestaurantProductsForVendor(
  restaurantId: string
): Promise<{
  categories: { id: string; name: string; sort_order: number; is_visible: boolean }[];
  products: VendorProductListItem[];
}> {
  const supabase = createServerSupabaseClient();

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase
      .from("product_categories")
      .select("id, name, sort_order, is_visible")
      .eq("restaurant_id", restaurantId)
      .order("sort_order")
      .order("name"),
    supabase
      .from("products")
      .select(
        "id, category_id, name, description, price_paise, image_path, cook_time_minutes, availability, inventory_mode, stock_quantity, archived_at, is_visible, sort_order"
      )
      .eq("restaurant_id", restaurantId)
      .order("sort_order")
      .order("name"),
  ]);

  return { categories: categories ?? [], products: products ?? [] };
}
