import { requireSuperAdmin } from "@/lib/auth/guards";
import { getRestaurantProductsForVendor } from "@/lib/data/products";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtCount, fmtDuration } from "@/lib/admin/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";
import { VisibilityToggle, ReorderControls } from "@/components/admin/catalog-controls";

/**
 * Restaurant workspace products (SRS §5.3 OPERATIONS, V2.6 §60).
 *
 * The Super Admin's controls here are exactly two: platform visibility and display
 * order. There is no price, description or stock editing, and that is a decision
 * rather than an omission — §60 grants the platform the ability to hide and reorder,
 * not to become a second editor of the vendor's catalogue. Two writers to the same
 * row with no way to tell whose intent is current is how a vendor's corrected price
 * gets silently reverted.
 *
 * Three states are shown separately because they mean different things and are
 * fixed by different people:
 *
 *   Hidden       -- the platform's decision (this page).
 *   Out of stock -- the vendor saying "not right now" (their dashboard).
 *   Archived     -- the vendor's soft delete (their dashboard).
 *
 * Archived products are listed, greyed, and cannot be reordered: they are not on
 * any menu, so their position is meaningless, but hiding them entirely would make
 * an operator think a product had been deleted.
 */

export const dynamic = "force-dynamic";

export default async function RestaurantProductsPage({ params }: { params: { restaurantId: string } }) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const { categories, products } = await getRestaurantProductsForVendor(restaurantId);
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const live = products.filter((p) => !p.archived_at);
  const archived = products.filter((p) => p.archived_at);

  // The id list submitted with every reorder. It is the LIVE products in display
  // order — the same order this table renders — so "up" means the same thing on
  // both sides of the request.
  const orderedIds = live.map((p) => p.id);

  const hiddenCount = live.filter((p) => !p.is_visible).length;
  const outOfStockCount = live.filter(
    (p) => p.availability === "out_of_stock" || (p.inventory_mode === "quantity" && (p.stock_quantity ?? 0) <= 0)
  ).length;

  return (
    <div>
      <PageHeader
        title="Products"
        description="Platform visibility and display order for this restaurant's catalogue. Prices, descriptions and stock are the vendor's to edit — a wrong price is a conversation with the vendor, not an override here."
      />

      <StatGrid className="lg:grid-cols-4">
        <Stat label="Live products" value={fmtCount(live.length)} hint="Not archived" />
        <Stat
          label="Hidden by platform"
          value={fmtCount(hiddenCount)}
          hint="Not listed to customers regardless of stock"
          tone={hiddenCount > 0 ? "warning" : "default"}
        />
        <Stat
          label="Out of stock"
          value={fmtCount(outOfStockCount)}
          hint="Vendor-controlled; includes quantity at zero"
        />
        <Stat label="Archived" value={fmtCount(archived.length)} hint="Vendor's soft delete, never removed" />
      </StatGrid>

      <Card className="mt-4">
        {live.length === 0 ? (
          <EmptyState
            title="This restaurant has no products"
            hint="Products are created by the vendor from their own dashboard. Nothing can be listed to customers until they add at least one."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Order</TH>
                  <TH>Product</TH>
                  <TH>Category</TH>
                  <THNum>Price</THNum>
                  <TH>Stock</TH>
                  <TH>Platform</TH>
                  <TH>Prep</TH>
                  <TH aria-label="Actions" />
                </TR>
              </THead>
              <TBody>
                {live.map((p, index) => {
                  const outOfStock =
                    p.availability === "out_of_stock" ||
                    (p.inventory_mode === "quantity" && (p.stock_quantity ?? 0) <= 0);
                  return (
                    <TR key={p.id} className="hover:bg-cream-100">
                      <TD>
                        <ReorderControls restaurantId={restaurantId} kind="product" ids={orderedIds} index={index} />
                      </TD>
                      <TD>
                        <span className="font-semibold text-ink">{p.name}</span>
                        {p.description ? (
                          <span className="block max-w-xs truncate text-[11px] text-ink-muted">{p.description}</span>
                        ) : null}
                      </TD>
                      <TD>{p.category_id ? categoryName.get(p.category_id) ?? "Unknown" : "Uncategorised"}</TD>
                      <TDNum>{paiseToRupeesDisplay(p.price_paise)}</TDNum>
                      <TD>
                        {outOfStock ? (
                          <Badge tone="danger">Out of stock</Badge>
                        ) : p.inventory_mode === "quantity" ? (
                          <span className="tabular-nums">{fmtCount(p.stock_quantity)} left</span>
                        ) : (
                          <Badge tone="success">Available</Badge>
                        )}
                      </TD>
                      <TD>
                        {p.is_visible ? <Badge tone="neutral">Listed</Badge> : <Badge tone="warning">Hidden</Badge>}
                      </TD>
                      <TD>{fmtDuration(p.cook_time_minutes)}</TD>
                      <TD>
                        <VisibilityToggle
                          restaurantId={restaurantId}
                          kind="product"
                          id={p.id}
                          isVisible={p.is_visible}
                        />
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {archived.length > 0 ? (
        <Card className="mt-4">
          <p className="font-display text-base font-semibold text-ink">Archived</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Kept because §P forbids deleting history — an archived product still appears on the orders that contained
            it. Restoring one is the vendor&apos;s action, from their own dashboard.
          </p>
          <TableWrap className="mt-3">
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>Category</TH>
                  <THNum>Price</THNum>
                  <TH>Platform</TH>
                </TR>
              </THead>
              <TBody>
                {archived.map((p) => (
                  <TR key={p.id} className="opacity-60">
                    <TD>{p.name}</TD>
                    <TD>{p.category_id ? categoryName.get(p.category_id) ?? "Unknown" : "Uncategorised"}</TD>
                    <TDNum>{paiseToRupeesDisplay(p.price_paise)}</TDNum>
                    <TD>{p.is_visible ? "Listed" : "Hidden"}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      ) : null}
    </div>
  );
}
