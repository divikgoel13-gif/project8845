import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ADMIN_PAGE_SIZE } from "@/components/ui/pagination";

/**
 * Global Menus (SRS Phase 9 "Global Menus"; V2.6 §60 visibility/ordering/
 * availability as distinct concepts).
 *
 * The restaurant workspace's Products and Menu & Categories pages
 * (`lib/data/products.ts`'s `getRestaurantProductsForVendor`) already own
 * full editing for ONE restaurant — price, image, description, cook time,
 * category, stock, sort order. This module does not re-implement any of
 * that. What it adds is the question the restaurant-scoped pages cannot
 * answer: "find this dish across every restaurant that sells it" and "which
 * restaurants currently have nothing visible to order at all" — genuinely
 * cross-restaurant questions that need one directory, not fourteen separate
 * visits into fourteen workspaces.
 *
 * Visibility is the one control this directory lets an operator flip
 * directly (reusing `VisibilityToggle`/`setProductVisibility` exactly as-is
 * — the component already takes a `restaurantId`, so a cross-restaurant row
 * needs no new component). Price, images, descriptions, cook time and sort
 * order stay restaurant-workspace-only: they are lower-risk to view globally
 * but editing them out of context (no menu preview, no category structure
 * visible) is a worse experience than the one click through to the
 * restaurant's own Products page — see "What Part B does not include".
 */

export type GlobalProductRow = {
  productId: string;
  restaurantId: string;
  restaurantName: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  pricePaise: number;
  availability: "available" | "out_of_stock";
  isVisible: boolean;
  archivedAt: string | null;
};

type RawProductRow = {
  id: string;
  restaurant_id: string;
  category_id: string | null;
  name: string;
  price_paise: number;
  availability: "available" | "out_of_stock";
  is_visible: boolean;
  archived_at: string | null;
  restaurants: { name: string } | null;
  product_categories: { name: string } | null;
};

const PRODUCT_SCAN_CAP = 20_000;

export type ProductDirectoryFilters = {
  search?: string;
  restaurantId?: string;
  visibility?: "visible" | "hidden" | "all";
  includeArchived?: boolean;
  page?: number;
};

/**
 * All products platform-wide, joined to restaurant and category name.
 * Archived products are excluded by default — an operator searching the
 * catalogue is almost always looking for something orderable or hideable,
 * not something already removed — but `includeArchived` surfaces them for
 * "did we used to sell this" questions.
 */
export async function listProductsAcrossRestaurants(
  filters: ProductDirectoryFilters = {}
): Promise<{ rows: GlobalProductRow[]; total: number; page: number; pageSize: number; truncated: boolean }> {
  const supabase = createServerSupabaseClient();

  let query = supabase
    .from("products")
    .select(
      "id, restaurant_id, category_id, name, price_paise, availability, is_visible, archived_at, restaurants(name), product_categories(name)",
      { count: "exact" }
    );

  if (!filters.includeArchived) query = query.is("archived_at", null);
  if (filters.restaurantId) query = query.eq("restaurant_id", filters.restaurantId);
  if (filters.visibility === "visible") query = query.eq("is_visible", true);
  if (filters.visibility === "hidden") query = query.eq("is_visible", false);

  const term = filters.search?.trim();
  if (term) query = query.ilike("name", `%${term}%`);

  const { data, count } = await query.order("name", { ascending: true }).limit(PRODUCT_SCAN_CAP);
  const all = ((data ?? []) as unknown as RawProductRow[]).map(
    (r): GlobalProductRow => ({
      productId: r.id,
      restaurantId: r.restaurant_id,
      restaurantName: r.restaurants?.name ?? "Unknown restaurant",
      categoryId: r.category_id,
      categoryName: r.product_categories?.name ?? null,
      name: r.name,
      pricePaise: r.price_paise,
      availability: r.availability,
      isVisible: r.is_visible,
      archivedAt: r.archived_at,
    })
  );

  const truncated = (count ?? all.length) > all.length;

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = ADMIN_PAGE_SIZE;
  const start = (page - 1) * pageSize;

  return { rows: all.slice(start, start + pageSize), total: all.length, page, pageSize, truncated };
}

export type MenuOverview = {
  totalProducts: number;
  visibleProducts: number;
  hiddenProducts: number;
  outOfStockProducts: number;
  /** Active restaurants with zero visible, in-catalogue products — nothing a customer can currently order. */
  restaurantsWithNothingVisible: { restaurantId: string; name: string }[];
  truncated: boolean;
};

export async function getMenuOverview(): Promise<MenuOverview> {
  const supabase = createServerSupabaseClient();

  const [restaurantRows, { data: products, count }] = await Promise.all([
    supabase.from("restaurants").select("id, name").is("archived_at", null).limit(2_000),
    supabase
      .from("products")
      .select("restaurant_id, is_visible, availability", { count: "exact" })
      .is("archived_at", null)
      .limit(PRODUCT_SCAN_CAP),
  ]);

  const rows = products ?? [];
  const truncated = (count ?? rows.length) > rows.length;

  const visibleByRestaurant = new Set<string>();
  let visibleProducts = 0;
  let outOfStockProducts = 0;

  for (const p of rows) {
    if (p.is_visible) {
      visibleProducts += 1;
      visibleByRestaurant.add(p.restaurant_id);
    }
    if (p.availability === "out_of_stock") outOfStockProducts += 1;
  }

  const restaurants = restaurantRows.data ?? [];
  const restaurantsWithNothingVisible = restaurants
    .filter((r) => !visibleByRestaurant.has(r.id))
    .map((r) => ({ restaurantId: r.id, name: r.name }));

  return {
    totalProducts: rows.length,
    visibleProducts,
    hiddenProducts: rows.length - visibleProducts,
    outOfStockProducts,
    restaurantsWithNothingVisible,
    truncated,
  };
}
