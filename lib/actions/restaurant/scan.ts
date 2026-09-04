"use server";

import { z } from "zod";
import { requireRestaurantScope } from "@/lib/auth/guards";
import {
  scanAndCollect,
  findCollectibleOrdersByPhone,
  collectOrderWithFallback,
  type CollectibleOrderForFallback,
  type ScanOutcome,
} from "@/lib/orders/scan";

/**
 * Scan/collect Server Actions — usable from BOTH the Staff portal
 * (SRS §11: "Scan verifies QR and marks eligible order collected") and
 * the Vendor Admin dashboard (SRS §10: "Scan Orders — Vendor Admin can
 * scan QRs"). `requireRestaurantScope` accepts both roles and
 * independently re-verifies an ACTIVE membership for the given
 * restaurant — never trust the restaurantId argument alone (SRS §17).
 */

const ScanSchema = z.object({
  restaurantId: z.string().uuid(),
  qrToken: z.string().trim().min(1),
});

export async function submitScan(input: unknown): Promise<ScanOutcome> {
  const parsed = ScanSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid scan input." };

  const profile = await requireRestaurantScope(parsed.data.restaurantId);
  return scanAndCollect(profile, parsed.data.restaurantId, parsed.data.qrToken);
}

const PhoneSearchSchema = z.object({
  restaurantId: z.string().uuid(),
  phoneQuery: z.string().trim().min(3),
});

export async function searchCollectibleOrdersByPhone(input: unknown): Promise<CollectibleOrderForFallback[]> {
  const parsed = PhoneSearchSchema.safeParse(input);
  if (!parsed.success) return [];

  await requireRestaurantScope(parsed.data.restaurantId);
  return findCollectibleOrdersByPhone(parsed.data.restaurantId, parsed.data.phoneQuery);
}

const FallbackCollectSchema = z.object({
  restaurantId: z.string().uuid(),
  orderId: z.string().uuid(),
  reason: z.string().trim().min(3, "Please briefly explain why the QR couldn't be scanned."),
});

export async function submitFallbackCollection(input: unknown): Promise<ScanOutcome> {
  const parsed = FallbackCollectSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  const profile = await requireRestaurantScope(parsed.data.restaurantId);
  return collectOrderWithFallback(profile, parsed.data.restaurantId, parsed.data.orderId, parsed.data.reason);
}
