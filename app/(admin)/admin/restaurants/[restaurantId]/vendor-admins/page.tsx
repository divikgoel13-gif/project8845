import { requireSuperAdmin } from "@/lib/auth/guards";
import { listRestaurantAccess, listGrantCandidates } from "@/lib/admin/restaurant-workspace";
import { fmtDateTime } from "@/lib/admin/format";
import { PageHeader, SectionHeading } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { TableWrap, Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { GrantAccessForm, AccessRowActions } from "@/components/admin/access-grant-controls";

/**
 * Restaurant workspace vendor admins (SRS §8 access control, §5.3 PEOPLE).
 *
 * A vendor admin is the account that owns the restaurant's own dashboard: menu,
 * prices, hours, payouts. Granting this is the heaviest access the console hands
 * out, which is why the page states what it confers rather than presenting it as a
 * neutral row in a table.
 *
 * Revoked grants stay listed with their date. §8 makes losing access a security
 * event and §P forbids destroying the record of one, so "was this person ever an
 * admin here" must be answerable from this page and not only from the audit log.
 *
 * There is no cap on vendor admins — the five-person limit in §11 is on STAFF, a
 * different table with a different trigger. Conflating the two would either block a
 * legitimate ownership change or silently let the staff limit be bypassed.
 */

export const dynamic = "force-dynamic";

export default async function RestaurantVendorAdminsPage({ params }: { params: { restaurantId: string } }) {
  await requireSuperAdmin();
  const { restaurantId } = params;

  const [{ vendorAdmins }, candidates] = await Promise.all([
    listRestaurantAccess(restaurantId),
    listGrantCandidates("vendor_admin"),
  ]);

  // A profile with a live grant is not a candidate. `grantRestaurantAccess` would
  // reject the duplicate anyway, but offering it in the picker invites the click.
  const alreadyGranted = new Set(vendorAdmins.filter((g) => !g.disabledAt).map((g) => g.userId));
  const selectable = candidates.filter((c) => !alreadyGranted.has(c.id));

  const active = vendorAdmins.filter((g) => !g.disabledAt);

  return (
    <div>
      <PageHeader
        title="Vendor Admins"
        description="Accounts that can manage this restaurant from the vendor dashboard: its menu, prices, hours and payout details. Granting access does not change what an account is — only an account that is already a vendor admin can be granted it."
      />

      <Card>
        <SectionHeading
          title="Grant access"
          description="Takes effect on the account's next request. No email is sent from here."
        />
        <GrantAccessForm restaurantId={restaurantId} role="vendor_admin" candidates={selectable} />
      </Card>

      <Card className="mt-4">
        <SectionHeading
          title={`Access list — ${active.length} active`}
          description="Revoked grants are kept with the date they ended, so the history of who could act on this restaurant stays answerable."
        />
        {vendorAdmins.length === 0 ? (
          <EmptyState
            title="No vendor admin has access to this restaurant"
            hint="Until one does, nobody can edit this menu or see these payouts from the vendor side. The platform can still trade the restaurant."
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
                {vendorAdmins.map((g) => (
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
                        role="vendor_admin"
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
