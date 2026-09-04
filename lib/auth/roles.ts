/**
 * The four UNI8 roles (SRS §4). Kept as a single source of truth so route
 * groups, middleware, guards, and the database enum (`app_role`) never
 * drift apart.
 */
export const APP_ROLES = ["customer", "vendor_admin", "staff", "super_admin"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export type AuthenticatedProfile = {
  id: string;
  role: AppRole;
  status: "active" | "disabled";
  name: string | null;
  email: string | null;
  phone: string | null;
};

/**
 * Coarse capability matrix — mirrors SRS §4/§10/§11 role scopes. This is
 * documentation-as-code for what each role is EXPECTED to be able to do;
 * actual enforcement always happens in guards.ts + RLS, never here alone.
 */
export const ROLE_CAPABILITIES: Record<AppRole, string[]> = {
  customer: [
    "browse_restaurants",
    "manage_own_cart",
    "checkout_own_order",
    "view_own_orders",
    "rate_own_completed_order",
    "raise_own_grievance",
  ],
  staff: [
    "view_assigned_restaurant_orders",
    "scan_assigned_restaurant_qr",
    "mark_assigned_restaurant_order_ready",
  ],
  vendor_admin: [
    "view_assigned_restaurant_dashboard",
    "manage_assigned_restaurant_products",
    "manage_assigned_restaurant_staff",
    "view_assigned_restaurant_payments",
    "acknowledge_assigned_restaurant_payout",
    "raise_vendor_grievance",
    "pause_assigned_restaurant_ordering",
    "cancel_assigned_restaurant_order",
  ],
  super_admin: ["*"], // platform-wide — see SRS §4/§8.
};
