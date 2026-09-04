import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Enums } from "@/types/database";

/**
 * Super-Admin grievance CRM read-side (SRS Phase 6: vendor grievances reach
 * UNI8; SRS §13 central grievance CRM). Super admin sees ALL tickets
 * (customer + vendor) via `grievance_tickets_select_own_or_admin`'s
 * `is_super_admin()` branch, and ALL messages including internal notes via
 * `grievance_messages_select_scoped`. RLS-bound client throughout — no
 * service-role needed because the super admin's own RLS grants full
 * visibility.
 */

export type AdminGrievanceListRow = {
  id: string;
  category: Enums<"grievance_category">;
  status: Enums<"grievance_status">;
  priority: Enums<"grievance_priority">;
  requesterRole: Enums<"grievance_role">;
  requesterName: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
  createdAt: string;
  updatedAt: string;
};

type TicketJoinRow = {
  id: string;
  category: Enums<"grievance_category">;
  status: Enums<"grievance_status">;
  priority: Enums<"grievance_priority">;
  requester_role: Enums<"grievance_role">;
  restaurant_id: string | null;
  created_at: string;
  updated_at: string;
  profiles: { name: string | null } | null;
  restaurants: { name: string } | null;
};

export async function listAdminGrievances(filter?: {
  requesterRole?: Enums<"grievance_role">;
  /**
   * Narrows to one restaurant's tickets. Added for the §5.3 restaurant
   * workspace, which needs the same rows the central inbox shows rather than a
   * second definition of "this restaurant's grievances" — filtering in the page
   * would mean fetching every ticket on the platform to display five.
   */
  restaurantId?: string;
}): Promise<AdminGrievanceListRow[]> {
  const supabase = createServerSupabaseClient();
  let query = supabase
    .from("grievance_tickets")
    .select(
      "id, category, status, priority, requester_role, restaurant_id, created_at, updated_at, profiles!grievance_tickets_requester_id_fkey(name), restaurants(name)"
    )
    .order("updated_at", { ascending: false });

  if (filter?.requesterRole) {
    query = query.eq("requester_role", filter.requesterRole);
  }
  if (filter?.restaurantId) {
    query = query.eq("restaurant_id", filter.restaurantId);
  }

  const { data, error } = await query;
  if (error || !data) return [];

  return (data as unknown as TicketJoinRow[]).map((t) => ({
    id: t.id,
    category: t.category,
    status: t.status,
    priority: t.priority,
    requesterRole: t.requester_role,
    requesterName: t.profiles?.name ?? null,
    restaurantId: t.restaurant_id,
    restaurantName: t.restaurants?.name ?? null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  }));
}

export type AdminGrievanceMessage = {
  id: string;
  body: string;
  createdAt: string;
  senderName: string | null;
  isInternal: boolean;
};

export type AdminGrievanceDetail = {
  id: string;
  category: Enums<"grievance_category">;
  status: Enums<"grievance_status">;
  priority: Enums<"grievance_priority">;
  requesterRole: Enums<"grievance_role">;
  requesterId: string;
  requesterName: string | null;
  restaurantId: string | null;
  restaurantName: string | null;
  orderId: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  messages: AdminGrievanceMessage[];
};

export async function getAdminGrievance(ticketId: string): Promise<AdminGrievanceDetail | null> {
  const supabase = createServerSupabaseClient();

  const { data: ticket } = await supabase
    .from("grievance_tickets")
    .select(
      "id, category, status, priority, requester_role, requester_id, restaurant_id, order_id, resolution_note, created_at, updated_at, profiles!grievance_tickets_requester_id_fkey(name), restaurants(name)"
    )
    .eq("id", ticketId)
    .maybeSingle();

  if (!ticket) return null;
  const t = ticket as unknown as TicketJoinRow & {
    requester_id: string;
    order_id: string | null;
    resolution_note: string | null;
  };

  const { data: messages } = await supabase
    .from("grievance_messages")
    .select("id, body, created_at, is_internal, profiles!grievance_messages_sender_id_fkey(name)")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });

  return {
    id: t.id,
    category: t.category,
    status: t.status,
    priority: t.priority,
    requesterRole: t.requester_role,
    requesterId: t.requester_id,
    requesterName: t.profiles?.name ?? null,
    restaurantId: t.restaurant_id,
    restaurantName: t.restaurants?.name ?? null,
    orderId: t.order_id,
    resolutionNote: t.resolution_note,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    messages: (messages ?? []).map((m: any) => ({
      id: m.id,
      body: m.body,
      createdAt: m.created_at,
      senderName: m.profiles?.name ?? null,
      isInternal: m.is_internal,
    })),
  };
}
