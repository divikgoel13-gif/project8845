import Link from "next/link";
import { notFound } from "next/navigation";

import { requireSuperAdmin } from "@/lib/auth/guards";
import {
  getRestaurantContext,
  restaurantStateSummary,
  restaurantWorkspaceNav,
  restaurantOperationalState,
} from "@/lib/admin/restaurant-context";
import { fmtDate } from "@/lib/admin/format";
import { Badge, restaurantStatusTone } from "@/components/ui/badge";
import { RestaurantWorkspaceNav } from "@/components/admin/restaurant-workspace-nav";

/**
 * Restaurant workspace shell (SRS §5.3).
 *
 * §5.3: the workspace "must permanently show which restaurant is being managed".
 * That is this layout's whole job, and it is a layout rather than a shared
 * component precisely so that it cannot be omitted from page eleven of fourteen.
 *
 * Two consequences worth stating:
 *
 *  - The unknown-id 404 happens here, once. No workspace page has to defend
 *    against a null restaurant, which is why they all read `getRestaurantContext`
 *    a second time without a null check being a hazard — Next.js dedupes the
 *    request within a render.
 *  - An archived or closed restaurant still renders its workspace. §P forbids
 *    deleting operational history, so hiding the workspace would make the archive
 *    unreadable. The state is stated in the header and the write actions guard
 *    themselves.
 */

export const dynamic = "force-dynamic";

export default async function RestaurantWorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { restaurantId: string };
}) {
  await requireSuperAdmin();

  const restaurant = await getRestaurantContext(params.restaurantId);
  if (!restaurant) notFound();

  const state = restaurantOperationalState(restaurant);
  const groups = restaurantWorkspaceNav(restaurant.id);

  return (
    <div>
      <div className="rounded-brand border border-cream-300 bg-cream-50 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link
              href="/admin/restaurants"
              className="text-xs font-semibold text-ink-muted hover:text-ink hover:underline"
            >
              Restaurants
            </Link>
            <h1 className="mt-0.5 truncate font-display text-xl font-bold text-ink sm:text-2xl">
              {restaurant.name}
            </h1>
            <p className="mt-0.5 text-xs text-ink-muted">
              <span className="font-mono">/{restaurant.slug}</span>
              {restaurant.location ? ` · ${restaurant.location}` : ""}
              {` · Added ${fmtDate(restaurant.createdAt)}`}
            </p>
          </div>

          <div className="flex flex-col items-start gap-1.5 sm:items-end">
            <Badge tone={restaurantStatusTone(state)}>{restaurantStateSummary(restaurant)}</Badge>
            {/*
              Classification is part of the permanent header, not buried in
              Settings: §29.1 makes it the field that decides whether customers
              are told they need campus access, so an operator changing anything
              on this restaurant should be able to see it without navigating.
            */}
            {restaurant.locationType === "inside_university" ? (
              <Badge tone="info">
                Inside university{restaurant.universityPlaceName ? ` · ${restaurant.universityPlaceName}` : ""}
              </Badge>
            ) : (
              <Badge tone="neutral">Outside university</Badge>
            )}
          </div>
        </div>

        <div className="mt-4 border-t border-cream-300 pt-3">
          <RestaurantWorkspaceNav groups={groups} />
        </div>
      </div>

      <div className="mt-5">{children}</div>
    </div>
  );
}
