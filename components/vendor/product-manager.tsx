"use client";

import { useState, useTransition } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  createProduct,
  updateProduct,
  archiveProduct,
  restoreProduct,
  setProductAvailability,
  setProductVisibility,
  setCategoryVisibility,
  reorderProducts,
  createCategory,
} from "@/lib/actions/vendor/products";
import { createBrowserSupabaseClient } from "@/lib/supabase/client";
import { buildStoragePath, STORAGE_BUCKETS } from "@/lib/storage/buckets";
import { paiseToRupeesDisplay, rupeesToPaise } from "@/lib/money";
import type { VendorProductListItem } from "@/lib/data/products";

type Category = { id: string; name: string; sort_order: number; is_visible: boolean };

type FormState = {
  productId: string | null; // null = creating a new product
  categoryId: string;
  name: string;
  description: string;
  priceRupees: string;
  cookTimeMinutes: string;
  imagePath: string | null;
  inventoryMode: "boolean" | "quantity";
  stockQuantity: string;
};

const EMPTY_FORM: FormState = {
  productId: null,
  categoryId: "",
  name: "",
  description: "",
  priceRupees: "",
  cookTimeMinutes: "",
  imagePath: null,
  inventoryMode: "boolean",
  stockQuantity: "",
};

/**
 * Vendor Admin Products page interactivity (SRS Phase 4, §10 Products
 * row: "Add/delete/edit product. Price required. Image/description/cook
 * time optional. Out-of-stock persists until re-enabled."). One
 * self-contained client island, following the same pattern as
 * components/restaurant/scan-form.tsx — a page-scoped form + list, not a
 * dozen small islands.
 */
export function ProductManager({
  restaurantId,
  categories: initialCategories,
  products: initialProducts,
}: {
  restaurantId: string;
  categories: Category[];
  products: VendorProductListItem[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  const [products, setProducts] = useState(initialProducts);
  const [form, setForm] = useState<FormState | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [uploadPending, setUploadPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openCreateForm() {
    setError(null);
    setForm({ ...EMPTY_FORM, categoryId: categories[0]?.id ?? "" });
  }

  function openEditForm(p: VendorProductListItem) {
    setError(null);
    setForm({
      productId: p.id,
      categoryId: p.category_id ?? "",
      name: p.name,
      description: p.description ?? "",
      priceRupees: (p.price_paise / 100).toString(),
      cookTimeMinutes: p.cook_time_minutes?.toString() ?? "",
      imagePath: p.image_path,
      inventoryMode: p.inventory_mode,
      stockQuantity: p.stock_quantity?.toString() ?? "",
    });
  }

  async function handleImageUpload(file: File) {
    setUploadPending(true);
    setError(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const path = buildStoragePath("restaurant", restaurantId, file.name);
      const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKETS.productImages).upload(path, file);
      if (uploadError) throw new Error(uploadError.message);
      setForm((f) => (f ? { ...f, imagePath: path } : f));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image upload failed.");
    } finally {
      setUploadPending(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setError(null);

    const priceRupees = Number(form.priceRupees);
    if (!form.name.trim() || Number.isNaN(priceRupees) || priceRupees < 0) {
      setError("A valid name and price are required.");
      return;
    }

    const payload = {
      restaurantId,
      categoryId: form.categoryId || null,
      name: form.name.trim(),
      description: form.description.trim() || null,
      pricePaise: rupeesToPaise(priceRupees),
      cookTimeMinutes: form.cookTimeMinutes ? Number(form.cookTimeMinutes) : null,
      imagePath: form.imagePath,
      inventoryMode: form.inventoryMode,
      stockQuantity: form.stockQuantity ? Number(form.stockQuantity) : null,
    };

    startTransition(async () => {
      try {
        if (form.productId) {
          await updateProduct({ ...payload, productId: form.productId });
          setProducts((prev) =>
            prev.map((p) =>
              p.id === form.productId
                ? {
                    ...p,
                    category_id: payload.categoryId,
                    name: payload.name,
                    description: payload.description,
                    price_paise: payload.pricePaise,
                    cook_time_minutes: payload.cookTimeMinutes,
                    image_path: payload.imagePath,
                    inventory_mode: payload.inventoryMode,
                    stock_quantity: payload.stockQuantity,
                  }
                : p
            )
          );
        } else {
          const created = await createProduct(payload);
          setProducts((prev) => [
            ...prev,
            {
              id: created.id,
              category_id: payload.categoryId,
              name: created.name,
              description: payload.description,
              price_paise: created.price_paise,
              cook_time_minutes: payload.cookTimeMinutes,
              image_path: payload.imagePath,
              availability: "available",
              inventory_mode: payload.inventoryMode,
              stock_quantity: payload.stockQuantity,
              archived_at: null,
              // Read back from the insert rather than assumed: createProduct
              // appends to the end of the category, so guessing a position here
              // would put the new row in the wrong place until the next reload.
              is_visible: created.is_visible,
              sort_order: created.sort_order,
            },
          ]);
        }
        setForm(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save product.");
      }
    });
  }

  function handleToggleAvailability(p: VendorProductListItem) {
    const next = p.availability === "available" ? "out_of_stock" : "available";
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, availability: next } : x)));
    startTransition(async () => {
      try {
        await setProductAvailability({ restaurantId, productId: p.id, availability: next });
      } catch (e) {
        setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, availability: p.availability } : x)));
        setError(e instanceof Error ? e.message : "Could not update availability.");
      }
    });
  }

  /**
   * §60 visibility, kept visibly separate from availability above. The two
   * buttons sit side by side because the distinction only makes sense when a
   * vendor can see both states at once: "Out of stock" still tells customers
   * this restaurant sells the dish, "Hidden" tells them nothing at all.
   */
  function handleToggleVisibility(p: VendorProductListItem) {
    const next = !p.is_visible;
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_visible: next } : x)));
    startTransition(async () => {
      try {
        await setProductVisibility({ restaurantId, productId: p.id, isVisible: next });
      } catch (e) {
        setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, is_visible: p.is_visible } : x)));
        setError(e instanceof Error ? e.message : "Could not update visibility.");
      }
    });
  }

  function handleToggleCategoryVisibility(c: Category) {
    const next = !c.is_visible;
    setCategories((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_visible: next } : x)));
    startTransition(async () => {
      try {
        await setCategoryVisibility({ restaurantId, categoryId: c.id, isVisible: next });
      } catch (e) {
        setCategories((prev) => prev.map((x) => (x.id === c.id ? { ...x, is_visible: c.is_visible } : x)));
        setError(e instanceof Error ? e.message : "Could not update category visibility.");
      }
    });
  }

  /**
   * §60 display order. Moving one product swaps it with its neighbour and then
   * sends the WHOLE category's order to the server, because the action
   * renumbers 0..n-1 from the array — sending a single swap would leave gaps
   * and duplicate positions whenever two admins edit the same menu.
   *
   * Up/down buttons rather than drag-and-drop: §27 makes every dashboard
   * phone-first, and drag ordering on a touch screen inside a scrolling table
   * is the interaction most likely to fail there.
   */
  function handleMove(p: VendorProductListItem, direction: -1 | 1) {
    const siblings = products
      .filter((x) => !x.archived_at && x.category_id === p.category_id)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    const index = siblings.findIndex((x) => x.id === p.id);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= siblings.length) return;

    const reordered = [...siblings];
    // Bounds are checked above (index came from findIndex on this same array
    // and target is confirmed 0..siblings.length-1), so both reads are safe.
    const a = reordered[index]!;
    const b = reordered[target]!;
    reordered[index] = b;
    reordered[target] = a;
    const positions = new Map(reordered.map((x, i) => [x.id, i]));

    const previous = products;
    setProducts((prev) =>
      prev.map((x) => (positions.has(x.id) ? { ...x, sort_order: positions.get(x.id)! } : x))
    );

    startTransition(async () => {
      try {
        await reorderProducts({ restaurantId, orderedIds: reordered.map((x) => x.id) });
      } catch (e) {
        setProducts(previous);
        setError(e instanceof Error ? e.message : "Could not reorder products.");
      }
    });
  }

  function handleArchiveToggle(p: VendorProductListItem) {
    const archiving = !p.archived_at;
    const nowIso = new Date().toISOString();
    setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, archived_at: archiving ? nowIso : null } : x)));
    startTransition(async () => {
      try {
        if (archiving) await archiveProduct({ restaurantId, productId: p.id });
        else await restoreProduct({ restaurantId, productId: p.id });
      } catch (e) {
        setProducts((prev) => prev.map((x) => (x.id === p.id ? { ...x, archived_at: p.archived_at } : x)));
        setError(e instanceof Error ? e.message : "Could not update product.");
      }
    });
  }

  function handleCreateCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setError(null);
    startTransition(async () => {
      try {
        const category = await createCategory({ restaurantId, name: newCategoryName.trim() });
        setCategories((prev) => [...prev, category]);
        setNewCategoryName("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not create category.");
      }
    });
  }

  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "Uncategorized";
  const categoryRank = (id: string | null) =>
    id === null ? Number.MAX_SAFE_INTEGER : categories.find((c) => c.id === id)?.sort_order ?? Number.MAX_SAFE_INTEGER;

  /**
   * Sorted with the SAME rule the customer menu uses — category order, then
   * `(sort_order, name)` within the category (lib/data/products.ts). A vendor
   * reordering against a differently-sorted list would be moving rows they
   * cannot map to what customers see, which makes the controls untrustworthy
   * even when they work.
   */
  const activeProducts = products
    .filter((p) => !p.archived_at)
    .sort(
      (a, b) =>
        categoryRank(a.category_id) - categoryRank(b.category_id) ||
        categoryName(a.category_id).localeCompare(categoryName(b.category_id)) ||
        a.sort_order - b.sort_order ||
        a.name.localeCompare(b.name)
    );
  const archivedProducts = products.filter((p) => p.archived_at);

  // First/last within its own category — the only positions where a move is a
  // no-op, since reordering never crosses category boundaries.
  function movability(p: VendorProductListItem) {
    const siblings = activeProducts.filter((x) => x.category_id === p.category_id);
    const index = siblings.findIndex((x) => x.id === p.id);
    return { canMoveUp: index > 0, canMoveDown: index >= 0 && index < siblings.length - 1 };
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <form onSubmit={handleCreateCategory} className="flex gap-2">
          <input
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="New category name"
            className="rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
          />
          <Button type="submit" variant="secondary" disabled={isPending || !newCategoryName.trim()}>
            Add category
          </Button>
        </form>
        <Button onClick={openCreateForm} disabled={isPending}>
          Add product
        </Button>
      </div>

      {error && <p className="mt-3 rounded-brand bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>}

      {form && (
        <Card className="mt-4">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <h3 className="font-display font-semibold">{form.productId ? "Edit product" : "New product"}</h3>

            <label className="text-sm font-medium">
              Name
              <input
                value={form.name}
                onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
                className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
                required
              />
            </label>

            <label className="text-sm font-medium">
              Category
              <select
                value={form.categoryId}
                onChange={(e) => setForm((f) => (f ? { ...f, categoryId: e.target.value } : f))}
                className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium">
              Price (₹) — required
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.priceRupees}
                onChange={(e) => setForm((f) => (f ? { ...f, priceRupees: e.target.value } : f))}
                className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
                required
              />
            </label>

            <label className="text-sm font-medium">
              Description (optional)
              <textarea
                value={form.description}
                onChange={(e) => setForm((f) => (f ? { ...f, description: e.target.value } : f))}
                className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
                rows={2}
              />
            </label>

            <label className="text-sm font-medium">
              Cook time, minutes (optional)
              <input
                type="number"
                min="0"
                value={form.cookTimeMinutes}
                onChange={(e) => setForm((f) => (f ? { ...f, cookTimeMinutes: e.target.value } : f))}
                className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
              />
            </label>

            <label className="text-sm font-medium">
              Image (optional)
              <input
                type="file"
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
                className="mt-1 block text-sm"
              />
              {uploadPending && <p className="mt-1 text-xs text-ink-muted">Uploading…</p>}
              {form.imagePath && <p className="mt-1 text-xs text-ink-muted">Uploaded: {form.imagePath}</p>}
            </label>

            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.inventoryMode === "quantity"}
                onChange={(e) =>
                  setForm((f) => (f ? { ...f, inventoryMode: e.target.checked ? "quantity" : "boolean" } : f))
                }
              />
              Track exact stock quantity
            </label>

            {form.inventoryMode === "quantity" && (
              <label className="text-sm font-medium">
                Stock quantity
                <input
                  type="number"
                  min="0"
                  value={form.stockQuantity}
                  onChange={(e) => setForm((f) => (f ? { ...f, stockQuantity: e.target.value } : f))}
                  className="mt-1 w-full rounded-brand border border-cream-300 bg-cream-50 px-3 py-2 text-sm"
                  required
                />
              </label>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={isPending || uploadPending}>
                {isPending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setForm(null)} disabled={isPending}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {categories.length > 0 && (
        <Card className="mt-6">
          <h2 className="font-display font-semibold">Categories</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Hiding a category removes the whole section from the customer menu. Nothing is deleted and stock is
            unchanged.
          </p>
          <ul className="mt-3 divide-y divide-cream-300">
            {[...categories]
              .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
              .map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className={c.is_visible ? "" : "text-ink-muted"}>{c.name}</span>
                  <button
                    onClick={() => handleToggleCategoryVisibility(c)}
                    disabled={isPending}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      c.is_visible ? "bg-success-bg text-success" : "bg-cream-200 text-ink-soft"
                    }`}
                  >
                    {c.is_visible ? "Shown on menu" : "Hidden"}
                  </button>
                </li>
              ))}
          </ul>
        </Card>
      )}

      <Card className="mt-6">
        <h2 className="font-display font-semibold">Active products</h2>
        {activeProducts.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">No products yet — add your first one above.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="pb-2 font-medium">Order</th>
                <th className="pb-2 font-medium">Product</th>
                <th className="pb-2 font-medium">Category</th>
                <th className="pb-2 font-medium">Price</th>
                <th className="pb-2 font-medium">Availability</th>
                <th className="pb-2 font-medium">On menu</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeProducts.map((p) => {
                const { canMoveUp, canMoveDown } = movability(p);
                return (
                  <tr key={p.id} className="border-t border-cream-300">
                    <td className="py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => handleMove(p, -1)}
                          disabled={isPending || !canMoveUp}
                          aria-label={`Move ${p.name} up`}
                          className="rounded-brand border border-cream-300 px-2 py-1 text-xs font-medium disabled:opacity-40"
                        >
                          Up
                        </button>
                        <button
                          onClick={() => handleMove(p, 1)}
                          disabled={isPending || !canMoveDown}
                          aria-label={`Move ${p.name} down`}
                          className="rounded-brand border border-cream-300 px-2 py-1 text-xs font-medium disabled:opacity-40"
                        >
                          Down
                        </button>
                      </div>
                    </td>
                    <td className="py-2">{p.name}</td>
                    <td className="py-2 text-ink-soft">{categoryName(p.category_id)}</td>
                    <td className="py-2">{paiseToRupeesDisplay(p.price_paise)}</td>
                    <td className="py-2">
                      <button
                        onClick={() => handleToggleAvailability(p)}
                        disabled={isPending}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          p.availability === "available" ? "bg-success-bg text-success" : "bg-danger-bg text-danger"
                        }`}
                      >
                        {p.availability === "available" ? "Available" : "Out of stock"}
                      </button>
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => handleToggleVisibility(p)}
                        disabled={isPending}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          p.is_visible ? "bg-success-bg text-success" : "bg-cream-200 text-ink-soft"
                        }`}
                      >
                        {p.is_visible ? "Shown" : "Hidden"}
                      </button>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          onClick={() => openEditForm(p)}
                          className="text-sm font-medium text-orange-600 underline"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleArchiveToggle(p)}
                          disabled={isPending}
                          className="text-sm font-medium text-danger underline"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {archivedProducts.length > 0 && (
        <Card className="mt-6">
          <h2 className="font-display font-semibold">Deleted products</h2>
          <table className="mt-3 w-full text-sm">
            <tbody>
              {archivedProducts.map((p) => (
                <tr key={p.id} className="border-t border-cream-300">
                  <td className="py-2">{p.name}</td>
                  <td className="py-2">{paiseToRupeesDisplay(p.price_paise)}</td>
                  <td className="py-2">
                    <button
                      onClick={() => handleArchiveToggle(p)}
                      disabled={isPending}
                      className="text-sm font-medium text-orange-600 underline"
                    >
                      Restore
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
