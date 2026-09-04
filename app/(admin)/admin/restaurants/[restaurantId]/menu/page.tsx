import { requireSuperAdmin } from "@/lib/auth/guards";
import { getRestaurantProductsForVendor } from "@/lib/data/products";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtCount } from "@/lib/admin/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { VisibilityToggle, ReorderControls } from "@/components/admin/catalog-controls";

/**
 * Restaurant workspace menu structure (SRS §5.3 OPERATIONS, V2.6 §60).
 *
 * The Products page is the flat inventory; this page is the SHAPE of the menu — the
 * sections a customer scrolls through, in the order they appear. They are separate
 * pages because they answer different questions ("is the paneri roll listed?" versus
 * "does Beverages come before Desserts?") and because reordering categories and
 * reordering products are two different `sort_order` columns.
 *
 * Hiding a category hides the SECTION only. Each product keeps its own
 * `is_visible`, so re-showing the category restores exactly what was there.
 * Cascading the flag downwards would overwrite per-product decisions with no way
 * to recover them, which is why `setCategoryVisibility` does not do it — and why
 * this page states the consequence rather than leaving an operator to discover it.
 *
 * A hidden category's products are still shown here, marked, because "why is this
 * product not on the menu when it says Listed" is otherwise unanswerable from the
 * Products page alone.
 */

export const dynamic = "force-dynamic";

export default async function RestaurantMenuPage({ params }: { params: { restaurantId: string } }) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const { categories, products } = await getRestaurantProductsForVendor(restaurantId);
  const live = products.filter((p) => !p.archived_at);

  const byCategory = new Map<string, typeof live>();
  const uncategorised: typeof live = [];
  for (const p of live) {
    if (!p.category_id) {
      uncategorised.push(p);
      continue;
    }
    const bucket = byCategory.get(p.category_id);
    if (bucket) bucket.push(p);
    else byCategory.set(p.category_id, [p]);
  }

  const categoryIds = categories.map((c) => c.id);

  return (
    <div>
      <PageHeader
        title="Menu & Categories"
        description="The customer-facing shape of this menu: which sections exist, in what order, and which are hidden by the platform. Hiding a section does not change the products inside it."
        actions={
          <ButtonLink href={`/admin/restaurants/${restaurantId}/products`} variant="ghost">
            Product inventory
          </ButtonLink>
        }
      />

      {categories.length === 0 ? (
        <EmptyState
          title="This restaurant has no categories"
          hint="Categories are created by the vendor. Until one exists, every product sits in an unnamed section at the top of the menu."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {categories.map((category, index) => {
            const items = byCategory.get(category.id) ?? [];
            const hiddenItems = items.filter((p) => !p.is_visible).length;
            return (
              <Card key={category.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-base font-semibold text-ink">{category.name}</h2>
                      {category.is_visible ? (
                        <Badge tone="neutral">Listed</Badge>
                      ) : (
                        <Badge tone="warning">Section hidden</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {fmtCount(items.length)} product{items.length === 1 ? "" : "s"}
                      {hiddenItems > 0 ? ` · ${fmtCount(hiddenItems)} hidden individually` : ""}
                      {` · position ${index + 1} of ${categories.length}`}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <ReorderControls
                      restaurantId={restaurantId}
                      kind="category"
                      ids={categoryIds}
                      index={index}
                    />
                    <VisibilityToggle
                      restaurantId={restaurantId}
                      kind="category"
                      id={category.id}
                      isVisible={category.is_visible}
                    />
                  </div>
                </div>

                {!category.is_visible ? (
                  <p className="mt-3 rounded-brand bg-warning-bg px-3 py-2 text-xs text-warning">
                    Customers do not see this section. The products below keep their own visibility, so showing the
                    section again restores exactly this list.
                  </p>
                ) : null}

                {items.length === 0 ? (
                  <p className="mt-3 text-xs text-ink-muted">
                    Empty section. An empty category is not rendered to customers even when it is listed.
                  </p>
                ) : (
                  <ul className="mt-3 divide-y divide-cream-200 border-t border-cream-200">
                    {items.map((p) => (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span className="text-sm text-ink-soft">
                          {p.name}
                          {!p.is_visible ? (
                            <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-warning">
                              hidden
                            </span>
                          ) : null}
                        </span>
                        <span className="text-sm tabular-nums text-ink">{paiseToRupeesDisplay(p.price_paise)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {uncategorised.length > 0 ? (
        <Card className="mt-3">
          <h2 className="font-display text-base font-semibold text-ink">Uncategorised</h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Products with no category. They appear at the top of the customer menu with no section heading — worth
            raising with the vendor rather than fixing here, since assigning a category is a catalogue edit.
          </p>
          <ul className="mt-3 divide-y divide-cream-200 border-t border-cream-200">
            {uncategorised.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <span className="text-sm text-ink-soft">{p.name}</span>
                <span className="text-sm tabular-nums text-ink">{paiseToRupeesDisplay(p.price_paise)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
