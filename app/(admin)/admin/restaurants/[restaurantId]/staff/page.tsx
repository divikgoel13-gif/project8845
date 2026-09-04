import { requireSuperAdmin } from "@/lib/auth/guards";
import { listRestaurantAccess, listGrantCandidates } from "@/lib/admin/restaurant-workspace";
import { fmtDateTime, fmtCount } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Stat, StatGrid } from "@/components/ui/stat";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { GrantAccessForm, AccessRowActions } from "@/components/admin/access-grant-controls";

/**
 * Restaurant workspace staff (SRS §8 access control, §11 five-staff cap, §5.3 PEOPLE).
 *
 * Staff are counter accounts: they see today's orders and mark them ready or
 * collected. They cannot touch the menu, prices or payouts — that is the vendor
 * admin's dashboard — so this is the safer grant of the two and the page says so.
 *
 * The five-active-staff cap is a database trigger (`enforce_staff_limit`, migration
 * 0006), not a rule this page owns. The remaining count is shown as a tile and the
 * grant form disables itself at the limit, but the trigger stays the authority: two
 * operators granting simultaneously would both pass a page-level check.
 *
 * The cap counts ACTIVE grants only. A revoked grant does not consume a slot, which
 * is why the list keeps revoked rows visible while the tile ignores them — otherwise
 * a restaurant that had rotated through ten staff would look permanently full.
 */

export const dynamic = "force-dynamic";

const STAFF_CAP = 5;

export default async function RestaurantStaffPage({ params }: { params: { restaurantId: string } }) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const [{ staff }, candidates] = await Promise.all([
    listRestaurantAccess(restaurantId),
    listGrantCandidates("staff"),
  ]);

  const active = staff.filter((g) => !g.disabledAt);
  const suspended = active.filter((g) => g.profileStatus === "disabled").length;
  const remaining = Math.max(0, STAFF_CAP - active.length);

  const alreadyGranted = new Set(active.map((g) => g.userId));
  const selectable = candidates.filter((c) => !alreadyGranted.has(c.id));

  return (
    <div>
      <PageHeader
        title="Staff"
        description="Counter accounts for this restaurant. Staff can see and progress today's orders; they cannot edit the menu, prices or payout details. A maximum of five may hold active access at once."
      />

      <StatGrid className="lg:grid-cols-3">
        <Stat label="Active staff" value={`${fmtCount(active.length)} of ${STAFF_CAP}`} hint="Revoked grants do not count" />
        <Stat
          label="Slots remaining"
          value={fmtCount(remaining)}
          hint="Enforced by the database, not only by this page"
          tone={remaining === 0 ? "warning" : "default"}
        />
        <Stat
          label="Suspended accounts"
          value={fmtCount(suspended)}
          hint="Hold access here but cannot sign in anywhere"
          tone={suspended > 0 ? "warning" : "default"}
        />
      </StatGrid>

      <Card className="mt-4">
        <SectionHeading
          title="Grant access"
          description="Takes effect on the account's next request. Only an account whose role is already staff can be granted this."
        />
        <GrantAccessForm
          restaurantId={restaurantId}
          role="staff"
          candidates={selectable}
          atCap={active.length >= STAFF_CAP}
        />
      </Card>

      <Card className="mt-4">
        <SectionHeading
          title="Access list"
          description="Revoked grants keep the date their access ended. Re-granting the same account clears that date rather than creating a second row, so the original grant date survives."
        />
        {staff.length === 0 ? (
          <EmptyState
            title="No staff have access to this restaurant"
            hint="Orders can still be progressed by a vendor admin. Staff accounts exist so counter work does not require the owner's login."
          />
        ) : (
          <TableWrap>
            <Table>
              <THead>
                <TR>
                  <TH>Account</TH>
                  <TH>Contact</TH>
                  <TH>Access</TH>
                  <TH>Platform account</TH>
                  <TH>Granted</TH>
                  <TH aria-label="Actions" />
                </TR>
              </THead>
              <TBody>
                {staff.map((g) => (
                  <TR key={g.id} className={g.disabledAt ? "opacity-60" : "hover:bg-cream-100"}>
                    <TD>
                      <span className="font-semibold text-ink">{g.name ?? "Unnamed account"}</span>
                    </TD>
                    <TD>
                      <span className="block">{g.email ?? "—"}</span>
                      {g.phone ? <span className="block text-[11px] text-ink-muted">{g.phone}</span> : null}
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
                        <Badge tone="danger">Disabled platform-wide</Badge>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap">{fmtDateTime(g.createdAt)}</TD>
                    <TD>
                      <AccessRowActions
                        restaurantId={restaurantId}
                        role="staff"
                        userId={g.userId}
                        isRevoked={Boolean(g.disabledAt)}
                        profileStatus={g.profileStatus}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
