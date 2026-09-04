import { requireRole } from "@/lib/auth/guards";
import { getMyRestaurants } from "@/lib/data/my-restaurants";
import { Card } from "@/components/ui/card";
import { ChangePasswordForm } from "@/components/vendor/change-password-form";

/**
 * Vendor Admin access/profile controls (SRS Phase 4 deliverable list).
 * Read-only identity + restaurant-scope summary, plus the one genuinely
 * self-service action available to an account holder: changing their own
 * password. Anything that changes WHO has access (creating another
 * vendor admin, adjusting restaurant scope) stays Super-Admin-only per
 * docs/AUTH_RBAC.md and is out of this page's scope.
 */
export default async function VendorProfilePage() {
  const profile = await requireRole("vendor_admin");
  const restaurants = await getMyRestaurants(profile);

  return (
    <div>
      <h1 className="text-2xl font-bold">Profile</h1>

      <Card className="mt-6">
        <h2 className="font-display font-semibold">Account</h2>
        <dl className="mt-3 flex flex-col gap-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-soft">Name</dt>
            <dd className="font-medium">{profile.name ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Email</dt>
            <dd className="font-medium">{profile.email ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-ink-soft">Role</dt>
            <dd className="font-medium">Vendor Admin</dd>
          </div>
        </dl>
      </Card>

      <Card className="mt-6">
        <h2 className="font-display font-semibold">Restaurants you manage</h2>
        {restaurants.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">You aren't currently assigned to a restaurant.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1 text-sm">
            {restaurants.map((r) => (
              <li key={r.id}>{r.name}</li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-muted">
          To change which restaurants you're assigned to, contact UNI8 support.
        </p>
      </Card>

      <div className="mt-6">
        <ChangePasswordForm />
      </div>
    </div>
  );
}
