"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth/guards";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const RatingSchema = z.object({
  orderId: z.string().uuid(),
  restaurantId: z.string().uuid(),
  stars: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

/**
 * Customer rating flow for eligible completed orders (SRS Phase 3
 * deliverable; SRS §9: "Ratings 1–5 stars for eligible completed
 * orders"). Uses the RLS-bound client deliberately — the
 * `ratings_insert_owner` policy (0006_rls_policies.sql) already enforces
 * exactly the eligibility rule that matters ("order belongs to this
 * customer AND order.status = 'collected'"), so there's no privileged
 * logic here for a service-role client to do instead. This is the kind
 * of write RLS is structurally well-suited to gate.
 */
export async function submitRating(input: unknown) {
  const profile = await requireRole("customer");
  const parsed = RatingSchema.parse(input);

  const supabase = createServerSupabaseClient();
  const { error } = await supabase.from("ratings").insert({
    order_id: parsed.orderId,
    customer_id: profile.id,
    restaurant_id: parsed.restaurantId,
    stars: parsed.stars,
    comment: parsed.comment ?? null,
  });

  if (error) {
    // Most likely cause: RLS rejected it (order not actually 'collected'
    // or not this customer's) or a rating already exists (orders.id is
    // UNIQUE on ratings.order_id) — either way, surface a plain message
    // rather than the raw Postgres error.
    throw new Error("Could not submit rating — this order may not be eligible, or you've already rated it.");
  }

  revalidatePath("/orders");
}
