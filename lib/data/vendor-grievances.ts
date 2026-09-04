import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";
import type { AuthenticatedProfile } from "@/lib/auth/roles";

/**
 * Vendor-side grievance read helpers (SRS Phase 6: "Vendor grievance
 * creation + messaging to Super Admin"). Uses the RLS-bound client, so
 * `grievance_tickets_select_own_or_admin` (requester_id = auth.uid())
 * guarantees a vendor only ever sees the tickets THEY raised — never a
 * customer's ticket and never another restaurant's (SRS §4/§13 hard
 * requirement: "Vendor grievances reach UNI8 only"). Internal notes
 * (grievance_messages.is_internal) are invisible to the vendor by the
 * `grievance_messages_select_scoped` policy, so this code doesn't need to
 * re-filter them — but we pass the RLS-bound client precisely so that
 * guarantee is enforced in Postgres, not just here.
 */

export type VendorGrievanceListRow = {
  id: string;
  category: Enums<"grievance_category">;
  status: Enums<"grievance_status">;
  priority: Enums<"grievance_priority">;
  createdAt: string;
  updatedAt: string;
  restaurantId: string | null;
  lastMessageAt: string | null;
};

export type VendorGrievanceMessage = {
  id: string;
  body: string;
  createdAt: string;
  fromSuperAdmin: boolean;
};

export type VendorGrievanceDetail = {
  id: string;
  category: Enums<"grievance_category">;
  status: Enums<"grievance_status">;
  priority: Enums<"grievance_priority">;
  createdAt: string;
  updatedAt: string;
  restaurantId: string | null;
  resolutionNote: string | null;
  messages: VendorGrievanceMessage[];
};

export async function listVendorGrievances(
  profile: AuthenticatedProfile
): Promise<VendorGrievanceListRow[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("grievance_tickets")
    .select("id, category, status, priority, created_at, updated_at, restaurant_id")
    .eq("requester_id", profile.id)
    .eq("requester_role", "vendor")
    .order("updated_at", { ascending: false });

  if (error || !data) return [];

  return data.map((t) => ({
    id: t.id,
    category: t.category,
    status: t.status,
    priority: t.priority,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    restaurantId: t.restaurant_id,
    lastMessageAt: null,
  }));
}

export async function getVendorGrievance(
  profile: AuthenticatedProfile,
  ticketId: string
): Promise<VendorGrievanceDetail | null> {
  const supabase = createServerSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select("id, category, status, priority, created_at, updated_at, restaurant_id, resolution_note, requester_id, requester_role")
    .eq("id", ticketId)
    .maybeSingle();

  // RLS already blocks other requesters' tickets, but re-assert scope here
  // as defense-in-depth — a vendor must never open a customer's ticket.
  if (!ticket || ticket.requester_id !== profile.id || ticket.requester_role !== "vendor") {
    return null;
  }

  const { data: messages } = await supabase
    .from("grievance_messages")
    .select("id, body, created_at, sender_id")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  return {
    id: ticket.id,
    category: ticket.category,
    status: ticket.status,
    priority: ticket.priority,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    restaurantId: ticket.restaurant_id,
    resolutionNote: ticket.resolution_note,
    messages: (messages ?? []).map((m) => ({
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      // Any message not sent by the vendor themselves is, from their
      // perspective, a reply from UNI8 support (RLS has already stripped
      // internal-only notes, so everything visible here is either their
      // own message or a genuine super-admin reply).
      fromSuperAdmin: m.sender_id !== profile.id,
    })),
  };
}
