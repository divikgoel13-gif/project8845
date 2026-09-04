/**
 * Supabase Storage bucket registry (SRS §3: "Storage structure for product
 * images, grievance attachments and payout proofs. Sensitive buckets
 * private.").
 *
 * Buckets themselves are created via Supabase dashboard/CLI (not raw SQL
 * migrations) — see docs/ARCHITECTURE.md "Storage setup" for the exact
 * `supabase storage` commands. This file is the single source of truth for
 * bucket NAMES so application code never hardcodes a string bucket id.
 */
export const STORAGE_BUCKETS = {
  /** Public — product photos shown to customers pre-auth. */
  productImages: "product-images",
  /** Public — logos/branding assets per restaurant. */
  restaurantBranding: "restaurant-branding",
  /** Private — grievance ticket attachments (screenshots, evidence). */
  grievanceAttachments: "grievance-attachments",
  /** Private — manual disbursement proof uploads (Super Admin only). */
  payoutProofs: "payout-proofs",
} as const;

export type StorageBucket = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

export const PRIVATE_BUCKETS: StorageBucket[] = [
  STORAGE_BUCKETS.grievanceAttachments,
  STORAGE_BUCKETS.payoutProofs,
];

export const PUBLIC_BUCKETS: StorageBucket[] = [
  STORAGE_BUCKETS.productImages,
  STORAGE_BUCKETS.restaurantBranding,
];

/**
 * Builds a scoped storage path so private-bucket access-control policies
 * can key off the path prefix (e.g. "restaurant/<id>/..." or
 * "ticket/<id>/..."), matching the Storage RLS policies documented in
 * docs/ARCHITECTURE.md.
 */
export function buildStoragePath(scope: string, id: string, filename: string): string {
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${scope}/${id}/${Date.now()}-${safeName}`;
}
