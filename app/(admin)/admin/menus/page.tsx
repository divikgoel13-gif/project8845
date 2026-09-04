import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import { listProductsAcrossRestaurants, getMenuOverview } from "@/lib/admin/menus";
import { listRestaurantOptions } from "@/lib/admin/restaurants";
import { paiseToRupeesDisplay } from "@/lib/money";
import { fmtCount } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Checkbox } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, THNum, TD, TDNum } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { VisibilityToggle } from "@/components/admin/catalog-controls";

/**
 * Global Menus (SRS Phase 9, V2.6 §60). See lib/admin/menus.ts for why
 * editing (price, image, description, cook time, sort order) stays on the
 * restaurant workspace's own Products page and only visibility is
 * actionable directly from here.
 */

export const dynamic = "force-dynamic";

type Query = {
  q?: string;
  restaurant?: string;
  visibility?: string;
  archived?: string;
  page?: string;
};

function pickVisibility(raw: string | undefined): "visible" | "hidden" | "all" {
  return raw === "visible" || raw === "hidden" ? raw : "all";
}

export default async function MenusPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const search = searchParams.q?.trim() || undefined;
  const restaurantId = searchParams.restaurant?.trim() || undefined;
  const visibility = pickVisibility(searchParams.visibility);
  const includeArchived = searchParams.archived === "1";
  const page = parsePage(searchParams.page);

  const [directory, overview, restaurantOptions] = await Promise.all([
    listProductsAcrossRestaurants({ search, restaurantId, visibility, includeArchived, page }),
    getMenuOverview(),
    listRestaurantOptions(),
  ]);

  const preserveParams = {
    q: search,
    restaurant: restaurantId,
    visibility: visibility === "all" ? undefined : visibility,
    archived: includeArchived ? "1" : undefined,
  };

  return (
    <div>
      <PageHeader
        title="Menus"
        description="Every product across every restaurant, searchable in one place. Price, images, descriptions, cook time and category order stay on each restaurant's own Products page — visibility is the one control you can flip directly from here."
      />

      {(directory.truncated || overview.truncated) ? (
        <Card className="mb-4 border-warning bg-warning-bg">
          <p className="text-xs text-warning">
            The platform has more products than one scan covers. Counts below are a floor — narrow with search
            or a restaurant filter for an exact list.
          </p>
        </Card>
      ) : null}

      <StatGrid>
        <Stat label="Products in catalogue" value={fmtCount(overview.totalProducts)} hint="Not archived" />
        <Stat label="Visible on a menu" value={fmtCount(overview.visibleProducts)} tone="success" />
        <Stat label="Hidden" value={fmtCount(overview.hiddenProducts)} tone={overview.hiddenProducts > 0 ? "warning" : "default"} />
        <Stat
          label="Restaurants with nothing visible"
          value={fmtCount(overview.restaurantsWithNothingVisible.length)}
          tone={overview.restaurantsWithNothingVisible.length > 0 ? "warning" : "default"}
        />
      </StatGrid>

      {overview.restaurantsWithNothingVisible.length > 0 ? (
        <Card className="mt-4">
          <SectionHeading
            title="Restaurants with nothing visible"
            description="A customer opening these right now sees an empty menu — either genuinely no products yet, or everything is hidden."
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {overview.restaurantsWithNothingVisible.map((r) => (
              <Link
                key={r.restaurantId}
                href={`/admin/restaurants/${r.restaurantId}/menu`}
                className="rounded-brand border border-cream-300 bg-cream-50 px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-cream-200"
              >
                {r.name}
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="mt-4">
        <form method="get" action="/admin/menus" className="flex flex-wrap items-end gap-3">
          <Field label="Search" htmlFor="q" className="w-64">
            <Input id="q" name="q" defaultValue={search ?? ""} placeholder="Product name" />
          </Field>
          <Field label="Restaurant" htmlFor="restaurant" className="w-56">
            <Select id="restaurant" name="restaurant" defaultValue={restaurantId ?? ""}>
              <option value="">All restaurants</option>
              {restaurantOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Visibility" htmlFor="visibility" className="w-44">
            <Select id="visibility" name="visibility" defaultValue={visibility}>
              <option value="all">Visible and hidden</option>
              <option value="visible">Visible only</option>
              <option value="hidden">Hidden only</option>
            </Select>
          </Field>
          <div className="pb-2">
            <Checkbox id="archived" name="archived" value="1" defaultChecked={includeArchived} label="Include archived" />
          </div>
          <Button type="submit">Apply</Button>
        </form>
      </Card>

      <Card className="mt-4 p-0">
        {directory.rows.length === 0 ? (
          <EmptyState title="No products match these filters" hint="Try a different search term or clear the restaurant filter." />
        ) : (
          <>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH>Restaurant</TH>
                    <TH>Category</TH>
                    <THNum>Price</THNum>
                    <TH>Status</TH>
                    <TH aria-label="Visibility" />
                  </TR>
                </THead>
                <TBody>
                  {directory.rows.map((p) => (
                    <TR key={p.productId} className={p.archivedAt ? "opacity-60" : "hover:bg-cream-100"}>
                      <TD className="font-medium text-ink">{p.name}</TD>
                      <TD>
                        <Link href={`/admin/restaurants/${p.restaurantId}/products`} className="hover:underline">
                          {p.restaurantName}
                        </Link>
                      </TD>
                      <TD>{p.categoryName ?? <span className="text-ink-muted">Uncategorised</span>}</TD>
                      <TDNum>{paiseToRupeesDisplay(p.pricePaise)}</TDNum>
                      <TD>
                        <div className="flex flex-wrap gap-1.5">
                          {p.archivedAt ? <Badge tone="neutral">Archived</Badge> : null}
                          {p.availability === "out_of_stock" ? <Badge tone="warning">Out of stock</Badge> : null}
                        </div>
                      </TD>
                      <TD>
                        {p.archivedAt ? (
                          <span className="text-xs text-ink-muted">—</span>
                        ) : (
                          <VisibilityToggle restaurantId={p.restaurantId} kind="product" id={p.productId} isVisible={p.isVisible} />
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <div className="p-4">
              <Pagination
                page={directory.page}
                pageSize={directory.pageSize}
                total={directory.total}
                basePath="/admin/menus"
                params={{ ...preserveParams, page: undefined }}
              />
            </div>
          </>
        )}
      </Card>

      <p className="mt-5 text-xs text-ink-muted">
        Need to edit price, image, description, cook time or category order? Open the product from its{" "}
        <Link href="/admin/restaurants" className="underline">
          restaurant's Products page
        </Link>
        .
      </p>
    </div>
  );
}
