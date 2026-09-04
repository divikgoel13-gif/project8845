/**
 * Creates local/staging test accounts for all four roles using the
 * Supabase Auth Admin API (requires SUPABASE_SERVICE_ROLE_KEY).
 *
 * NOT for production. Run with:
 *   npx tsx scripts/seed-auth-users.ts
 *
 * Vendor Admin / Staff / Super Admin authenticate with email + password
 * (SRS §3: "Vendor/Admin/Staff role-controlled authentication"). Customer
 * auth is phone + OTP and is not seeded here — use the real OTP flow
 * against a Supabase test phone number, or Supabase Auth's local test
 * OTP bypass in development.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in the environment."
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type SeedUser = {
  email: string;
  password: string;
  role: "super_admin" | "vendor_admin" | "staff";
  name: string;
};

const users: SeedUser[] = [
  { email: "owner@uni8.test", password: "ChangeMe123!", role: "super_admin", name: "UNI8 Owner" },
  { email: "vendor.campusgrill@uni8.test", password: "ChangeMe123!", role: "vendor_admin", name: "Campus Grill Vendor" },
  { email: "staff.campusgrill@uni8.test", password: "ChangeMe123!", role: "staff", name: "Campus Grill Staff" },
];

async function main() {
  for (const u of users) {
    const { data: created, error } = await admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
    });

    if (error) {
      console.error(`Failed to create ${u.email}:`, error.message);
      continue;
    }

    const userId = created.user.id;

    // profiles row is normally created by the on-auth-user-created trigger
    // (see docs/AUTH.md) — but for a one-shot seed script we upsert directly
    // via the service-role client, which bypasses RLS deliberately.
    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ id: userId, role: u.role, email: u.email, name: u.name, status: "active" });

    if (profileError) {
      console.error(`Failed to upsert profile for ${u.email}:`, profileError.message);
      continue;
    }

    console.log(`Seeded ${u.role}: ${u.email} / ${u.password}`);
  }

  // Attach the vendor admin + staff test accounts to Campus Grill.
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, email")
    .in("email", ["vendor.campusgrill@uni8.test", "staff.campusgrill@uni8.test"]);

  const restaurantId = "00000000-0000-0000-0000-000000000101";
  const vendor = profiles?.find((p) => p.email === "vendor.campusgrill@uni8.test");
  const staff = profiles?.find((p) => p.email === "staff.campusgrill@uni8.test");

  if (vendor) {
    await admin.from("vendor_admin_memberships").upsert({ user_id: vendor.id, restaurant_id: restaurantId });
  }
  if (staff) {
    await admin.from("restaurant_staff").upsert({ user_id: staff.id, restaurant_id: restaurantId });
  }

  console.log("Done.");
}

main();
