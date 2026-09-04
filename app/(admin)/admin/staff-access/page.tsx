import Link from "next/link";

import { requireSuperAdmin } from "@/lib/auth/guards";
import {
  listStaffAccessDirectory,
  getStaffAccessOverview,
  type StaffAccessRole,
} from "@/lib/admin/staff-access";
import { listGrantCandidates } from "@/lib/admin/restaurant-workspace";
import { listRestaurantOptions } from "@/lib/admin/restaurants";
import { fmtCount, fmtDateTime } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { GlobalGrantAccessForm, AccessRowActions, ForceLogoutButton } from "@/components/admin/access-grant-controls";

/**
 * Global Staff & Access centre (SRS §8, §5.1, Phase 9). See
 * lib/admin/staff-access.ts for why this reads and mutates the exact same
 * two grant tables the restaurant workspace's Staff/Vendor Admins pages use,
 * rather than owning a parallel model.
 */

export const dynamic = "force-dynamic";

type Query = {
  q?: string;
  role?: string;
  status?: string;
  restaurant?: string;
  page?: string;
};

function pickRole(raw: string | undefined): StaffAccessRole | "all" {
  return raw === "vendor_admin" || raw === "staff" ? raw : "all";
}

function pickStatus(raw: string | undefined): "active" | "disabled" | "all" {
  return raw === "active" || raw === "disabled" ? raw : "all";
}

export default async function StaffAccessPage({ searchParams }: { searchParams: Query }) {
  await requireSuperAdmin();

  const search = searchParams.q?.trim() || undefined;
  const role = pickRole(searchParams.role);
  const status = pickStatus(searchParams.status);
  const restaurantId = searchParams.restaurant?.trim() || undefined;
  const page = parsePage(searchParams.page);

  const [directory, overview, restaurantOptions, vendorAdminCandidates, staffCandidates] = await Promise.all([
    listStaffAccessDirectory({ search, role, status, restaurantId, page }),
    getStaffAccessOverview(),
    listRestaurantOptions(),
    listGrantCandidates("vendor_admin"),
    listGrantCandidates("staff"),
  ]);

  const preserveParams = {
    q: search,
    role: role === "all" ? undefined : role,
    status: status === "all" ? undefined : status,
    restaurant: restaurantId,
  };

  return (
    <div>
      <PageHeader
        title="Staff & Access"
        description="Every vendor admin and staff grant across every restaurant, in one directory. Editing who has access still writes to the same two tables the restaurant workspace uses — nothing here is a separate model."
      />

      {overview.truncated ? (
        <Card className="mb-4 border-warning bg-warning-bg">
          <p className="text-xs text-warning">
            The platform has more access grants than one scan covers. Counts below are a floor.
          </p>
        </Card>
      ) : null}

      <StatGrid>
        <Stat label="Vendor admins" value={fmtCount(overview.vendorAdminCount)} hint="Distinct people, across all restaurants" />
        <Stat label="Staff" value={fmtCount(overview.staffCount)} hint="Distinct people, across all restaurants" />
        <Stat
          label="Disabled platform-wide"
          value={fmtCount(overview.platformDisabledCount)}
          tone={overview.platformDisabledCount > 0 ? "warning" : "default"}
        />
        <Stat
          label="Restaurants with no active staff"
          value={fmtCount(overview.restaurantsWithNoActiveStaff.length)}
          hint="Vendor admin only, or nobody at all"
          tone={overview.restaurantsWithNoActiveStaff.length > 0 ? "warning" : "default"}
        />
      </StatGrid>

      {overview.restaurantsWithNoActiveStaff.length > 0 ? (
        <Card className="mt-4">
          <SectionHeading title="Restaurants with no active staff" description="Counter accounts, specifically — a vendor admin can still work orders themselves." />
          <div className="mt-2 flex flex-wrap gap-2">
            {overview.restaurantsWithNoActiveStaff.map((r) => (
              <Link
                key={r.restaurantId}
                href={`/admin/restaurants/${r.restaurantId}/staff`}
                className="rounded-brand border border-cream-300 bg-cream-50 px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-cream-200"
              >
                {r.name}
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="mt-4">
        <SectionHeading title="Grant vendor admin access" description="Restaurant plus person — no need to open that restaurant's workspace first." />
        <GlobalGrantAccessForm role="vendor_admin" restaurantOptions={restaurantOptions} candidates={vendorAdminCandidates} />
      </Card>

      <Card className="mt-4">
        <SectionHeading title="Grant staff access" description="Subject to the five-active-staff cap per restaurant, enforced by the database." />
        <GlobalGrantAccessForm role="staff" restaurantOptions={restaurantOptions} candidates={staffCandidates} />
      </Card>

      <Card className="mt-4">
        <form method="get" action="/admin/staff-access" className="flex flex-wrap items-end gap-3">
          <Field label="Search" htmlFor="q" className="w-64">
            <Input id="q" name="q" defaultValue={search ?? ""} placeholder="Name, email, phone or restaurant" />
          </Field>
          <Field label="Role" htmlFor="role" className="w-40">
            <Select id="role" name="role" defaultValue={role}>
              <option value="all">All roles</option>
              <option value="vendor_admin">Vendor admin</option>
              <option value="staff">Staff</option>
            </Select>
          </Field>
          <Field label="Account status" htmlFor="status" className="w-44">
            <Select id="status" name="status" defaultValue={status}>
              <option value="all">All accounts</option>
              <option value="active">Enabled</option>
              <option value="disabled">Disabled platform-wide</option>
            </Select>
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
          <Button type="submit">Apply</Button>
        </form>
      </Card>

      <Card className="mt-4 p-0">
        {directory.rows.length === 0 ? (
          <EmptyState
            title="No grants match these filters"
            hint="Try clearing the search term or widening the role and restaurant filters."
          />
        ) : (
          <>
            <TableWrap>
              <Table>
                <THead>
                  <TR>
                    <TH>Account</TH>
                    <TH>Contact</TH>
                    <TH>Role</TH>
                    <TH>Restaurant</TH>
                    <TH>Access</TH>
                    <TH>Platform account</TH>
                    <TH>Granted</TH>
                    <TH aria-label="Actions" />
                  </TR>
                </THead>
                <TBody>
                  {directory.rows.map((g) => (
                    <TR key={g.grantId} className={g.disabledAt ? "opacity-60" : "hover:bg-cream-100"}>
                      <TD className="font-semibold text-ink">{g.name ?? "Unnamed account"}</TD>
                      <TD>
                        <span className="block">{g.email ?? "—"}</span>
                        {g.phone ? <span className="block text-[11px] text-ink-muted">{g.phone}</span> : null}
                      </TD>
                      <TD>
                        <Badge tone={g.role === "vendor_admin" ? "info" : "neutral"}>
                          {g.role === "vendor_admin" ? "Vendor admin" : "Staff"}
                        </Badge>
                      </TD>
                      <TD>
                        <Link href={`/admin/restaurants/${g.restaurantId}/staff`} className="hover:underline">
                          {g.restaurantName}
                        </Link>
                      </TD>
                      <TD>
                        {g.disabledAt ? (
                          <Badge tone="neutral">Revoked {fmtDateTime(g.disabledAt)}</Badge>
                        ) : (
                          <Badge tone="success">Active</Badge>
                        )}
                      </TD>
                      <TD>
                        {g.profileStatus === "active" ? (
                          <Badge tone="neutral">Enabled</Badge>
                        ) : (
                          <Badge tone="danger">Disabled</Badge>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap">{fmtDateTime(g.grantedAt)}</TD>
                      <TD>
                        <div className="flex flex-col gap-1.5">
                          <AccessRowActions
                            restaurantId={g.restaurantId}
                            role={g.role}
                            userId={g.userId}
                            isRevoked={Boolean(g.disabledAt)}
                            profileStatus={g.profileStatus}
                          />
                          <ForceLogoutButton userId={g.userId} restaurantId={g.restaurantId} />
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
            <div className="p-4">
              <Pagination page={directory.page} pageSize={directory.pageSize} total={directory.total} basePath="/admin/staff-access" params={{ ...preserveParams, page: undefined }} />
            </div>
          </>
        )}
      </Card>

      <p className="mt-5 text-xs text-ink-muted">
        Need the full history for one restaurant, including revoked grants and who granted them? Open{" "}
        <Link href="/admin/restaurants" className="underline">
          that restaurant's workspace
        </Link>{" "}
        and go to Staff or Vendor Admins.
      </p>
    </div>
  );
}
