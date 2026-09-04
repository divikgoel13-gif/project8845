/**
 * Supabase-generated types — regenerated from the live `uni8` project
 * (nxgzpocmqgfotzkmcklr) after migrations 0001-0014 were applied.
 * Replaces Developer 1's hand-written placeholder (see
 * docs/PHASE_GATE_ACCEPTANCE_RECORD_1.md for how/when that happened).
 * Regenerate again after any future migration changes the schema:
 *   supabase gen types typescript --project-id nxgzpocmqgfotzkmcklr > types/database.ts
 *
 * DEVELOPER 3 NOTE (Phases 7-9): the additions from migrations 0016-0019
 * (customer_admin_notes, customer_flags, data_retention_policies,
 * financial_reconciliation_items, grievance_assignments, grievance_templates,
 * notification_templates, operational_alert_acks, sms_provider_events, plus new
 * columns on announcements, fraud_flags and grievance_tickets) were written
 * BY HAND in the generator's exact output shape, because the npm registry is
 * unreachable in the build environment used for Phases 7-9 (403) and therefore
 * `supabase gen types` could not be run. See docs/KNOWN_ISSUES.md.
 *
 * They are believed correct, but the authoritative source is the SQL in
 * supabase/migrations/. Whoever next has registry/CLI access should re-run the
 * generator and diff; scripts/verify-static.mjs cross-checks every column name
 * referenced by application code against the migrations, which catches the
 * realistic failure mode (a typo'd column) even without the generator.
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "admin_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      announcements: {
        Row: {
          archived_at: string | null
          created_at: string
          created_by: string | null
          ends_at: string | null
          id: string
          is_published: boolean
          message: string
          restaurant_id: string | null
          scope: string
          severity: string
          starts_at: string | null
          title: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          is_published?: boolean
          message: string
          restaurant_id?: string | null
          scope?: string
          severity?: string
          starts_at?: string | null
          title: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string | null
          id?: string
          is_published?: boolean
          message?: string
          restaurant_id?: string | null
          scope?: string
          severity?: string
          starts_at?: string | null
          title?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "announcements_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "announcements_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: Database["public"]["Enums"]["app_role"] | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          reason: string | null
          restaurant_id: string | null
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          restaurant_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: Database["public"]["Enums"]["app_role"] | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          restaurant_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      cart_items: {
        Row: {
          cart_id: string
          created_at: string
          id: string
          product_id: string
          quantity: number
        }
        Insert: {
          cart_id: string
          created_at?: string
          id?: string
          product_id: string
          quantity: number
        }
        Update: {
          cart_id?: string
          created_at?: string
          id?: string
          product_id?: string
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "cart_items_cart_id_fkey"
            columns: ["cart_id"]
            isOneToOne: false
            referencedRelation: "carts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cart_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      carts: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "carts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_admin_notes: {
        Row: {
          author_id: string
          body: string
          created_at: string
          customer_id: string
          id: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          customer_id: string
          id?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          customer_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_admin_notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_admin_notes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_flags: {
        Row: {
          clear_reason: string | null
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          created_by: string
          customer_id: string
          flag: string
          id: string
          reason: string
        }
        Insert: {
          clear_reason?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          created_by: string
          customer_id: string
          flag: string
          id?: string
          reason: string
        }
        Update: {
          clear_reason?: string | null
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string
          flag?: string
          id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_flags_cleared_by_fkey"
            columns: ["cleared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_flags_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_flags_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      data_retention_policies: {
        Row: {
          automated: boolean
          disposition: string
          domain: string
          rationale: string | null
          retention_period: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          automated?: boolean
          disposition: string
          domain: string
          rationale?: string | null
          retention_period: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          automated?: boolean
          disposition?: string
          domain?: string
          rationale?: string | null
          retention_period?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_retention_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      disbursements: {
        Row: {
          acknowledged_at: string | null
          admin_id: string
          amount_paise: number
          covers: Json
          created_at: string
          id: string
          not_received_escalated_ticket_id: string | null
          proof_path: string
          reference: string | null
          restaurant_id: string
          status: Database["public"]["Enums"]["disbursement_status"]
        }
        Insert: {
          acknowledged_at?: string | null
          admin_id: string
          amount_paise: number
          covers?: Json
          created_at?: string
          id?: string
          not_received_escalated_ticket_id?: string | null
          proof_path: string
          reference?: string | null
          restaurant_id: string
          status?: Database["public"]["Enums"]["disbursement_status"]
        }
        Update: {
          acknowledged_at?: string | null
          admin_id?: string
          amount_paise?: number
          covers?: Json
          created_at?: string
          id?: string
          not_received_escalated_ticket_id?: string | null
          proof_path?: string
          reference?: string | null
          restaurant_id?: string
          status?: Database["public"]["Enums"]["disbursement_status"]
        }
        Relationships: [
          {
            foreignKeyName: "disbursements_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disbursements_escalation_ticket_fk"
            columns: ["not_received_escalated_ticket_id"]
            isOneToOne: false
            referencedRelation: "grievance_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "disbursements_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          description: string | null
          enabled: boolean
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          description?: string | null
          enabled?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          description?: string | null
          enabled?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_reconciliation_items: {
        Row: {
          actual_paise: number | null
          detected_at: string
          details: Json
          disbursement_id: string | null
          expected_paise: number | null
          fingerprint: string
          id: string
          item_type: string
          last_seen_at: string
          order_id: string | null
          payment_id: string | null
          refund_event_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          restaurant_id: string | null
          severity: string
          status: string
        }
        Insert: {
          actual_paise?: number | null
          detected_at?: string
          details?: Json
          disbursement_id?: string | null
          expected_paise?: number | null
          fingerprint: string
          id?: string
          item_type: string
          last_seen_at?: string
          order_id?: string | null
          payment_id?: string | null
          refund_event_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          restaurant_id?: string | null
          severity?: string
          status?: string
        }
        Update: {
          actual_paise?: number | null
          detected_at?: string
          details?: Json
          disbursement_id?: string | null
          expected_paise?: number | null
          fingerprint?: string
          id?: string
          item_type?: string
          last_seen_at?: string
          order_id?: string | null
          payment_id?: string | null
          refund_event_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          restaurant_id?: string | null
          severity?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_reconciliation_items_disbursement_id_fkey"
            columns: ["disbursement_id"]
            isOneToOne: false
            referencedRelation: "disbursements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_items_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_items_refund_event_id_fkey"
            columns: ["refund_event_id"]
            isOneToOne: false
            referencedRelation: "refund_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_items_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_reconciliation_items_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      fraud_flags: {
        Row: {
          created_at: string
          details: Json
          id: string
          last_seen_at: string
          occurrences: number
          resolution_note: string | null
          resolved_at: string | null
          reviewed_by: string | null
          signal: string
          status: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          created_at?: string
          details?: Json
          id?: string
          last_seen_at?: string
          occurrences?: number
          resolution_note?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          signal: string
          status?: string
          subject_id: string
          subject_type: string
        }
        Update: {
          created_at?: string
          details?: Json
          id?: string
          last_seen_at?: string
          occurrences?: number
          resolution_note?: string | null
          resolved_at?: string | null
          reviewed_by?: string | null
          signal?: string
          status?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "fraud_flags_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      grievance_assignments: {
        Row: {
          actor_id: string
          created_at: string
          from_assignee_id: string | null
          id: string
          note: string | null
          ticket_id: string
          to_assignee_id: string | null
        }
        Insert: {
          actor_id: string
          created_at?: string
          from_assignee_id?: string | null
          id?: string
          note?: string | null
          ticket_id: string
          to_assignee_id?: string | null
        }
        Update: {
          actor_id?: string
          created_at?: string
          from_assignee_id?: string | null
          id?: string
          note?: string | null
          ticket_id?: string
          to_assignee_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "grievance_assignments_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grievance_assignments_from_assignee_id_fkey"
            columns: ["from_assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grievance_assignments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "grievance_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grievance_assignments_to_assignee_id_fkey"
            columns: ["to_assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      grievance_attachments: {
        Row: {
          created_at: string
          id: string
          message_id: string | null
          storage_path: string
          ticket_id: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          id?: string
          message_id?: string | null
          storage_path: string
          ticket_id: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          id?: string
          message_id?: string | null
          storage_path?: string
          ticket_id?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "grievance_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "grievance_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grievance_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "grievance_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grievance_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      grievance_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json
          ticket_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          ticket_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grievance_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grievance_events_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "grievance_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      grievance_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          is_internal: boolean
          sender_id: string
          ticket_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_internal?: boolean
          sender_id: string
          ticket_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_internal?: boolean
          sender_id?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "grievance_messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grievance_messages_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "grievance_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      grievance_templates: {
        Row: {
          body: string
          category: Database["public"]["Enums"]["grievance_category"] | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          body: string
          category?: Database["public"]["Enums"]["grievance_category"] | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          body?: string
          category?: Database["public"]["Enums"]["grievance_category"] | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grievance_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      grievance_tickets: {
        Row: {
          assignee_id: string | null
          category: Database["public"]["Enums"]["grievance_category"]
          closed_at: string | null
          created_at: string
          csat_comment: string | null
          csat_score: number | null
          csat_submitted_at: string | null
          escalated_at: string | null
          escalated_by: string | null
          escalation_reason: string | null
          first_response_at: string | null
          first_response_due_at: string | null
          id: string
          order_id: string | null
          priority: Database["public"]["Enums"]["grievance_priority"]
          reopen_reason: string | null
          reopened_at: string | null
          reopened_count: number
          requester_id: string
          requester_role: Database["public"]["Enums"]["grievance_role"]
          resolution_category: string | null
          resolution_due_at: string | null
          resolution_note: string | null
          resolved_at: string | null
          restaurant_id: string | null
          sla_policy_snapshot: Json | null
          status: Database["public"]["Enums"]["grievance_status"]
          ticket_no: number
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          category: Database["public"]["Enums"]["grievance_category"]
          closed_at?: string | null
          created_at?: string
          csat_comment?: string | null
          csat_score?: number | null
          csat_submitted_at?: string | null
          escalated_at?: string | null
          escalated_by?: string | null
          escalation_reason?: string | null
          first_response_at?: string | null
          first_response_due_at?: string | null
          id?: string
          order_id?: string | null
          priority?: Database["public"]["Enums"]["grievance_priority"]
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_count?: number
          requester_id: string
          requester_role: Database["public"]["Enums"]["grievance_role"]
          resolution_category?: string | null
          resolution_due_at?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          restaurant_id?: string | null
          sla_policy_snapshot?: Json | null
          status?: Database["public"]["Enums"]["grievance_status"]
          ticket_no?: number
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          category?: Database["public"]["Enums"]["grievance_category"]
          closed_at?: string | null
          created_at?: string
          csat_comment?: string | null
          csat_score?: number | null
          csat_submitted_at?: string | null
          escalated_at?: string | null
          escalated_by?: string | null
          escalation_reason?: string | null
          first_response_at?: string | null
          first_response_due_at?: string | null
          id?: string
          order_id?: string | null
          priority?: Database["public"]["Enums"]["grievance_priority"]
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_count?: number
          requester_id?: string
          requester_role?: Database["public"]["Enums"]["grievance_role"]
          resolution_category?: string | null
          resolution_due_at?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          restaurant_id?: string | null
          sla_policy_snapshot?: Json | null
          status?: Database["public"]["Enums"]["grievance_status"]
          ticket_no?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grievance_tickets_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grievance_tickets_escalated_by_fkey"
            columns: ["escalated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grievance_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grievance_tickets_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "grievance_tickets_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_mode: {
        Row: {
          is_active: boolean
          key: string
          message: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          is_active?: boolean
          key?: string
          message?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          is_active?: boolean
          key?: string
          message?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_mode_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      multi_order_groups: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          qr_token: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          qr_token?: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          qr_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "multi_order_groups_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_templates: {
        Row: {
          body: string
          channel: string
          description: string | null
          dlt_template_id: string | null
          is_active: boolean
          key: string
          title: string | null
          updated_at: string
          updated_by: string | null
          variables: Json
        }
        Insert: {
          body: string
          channel?: string
          description?: string | null
          dlt_template_id?: string | null
          is_active?: boolean
          key: string
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          variables?: Json
        }
        Update: {
          body?: string
          channel?: string
          description?: string | null
          dlt_template_id?: string | null
          is_active?: boolean
          key?: string
          title?: string | null
          updated_at?: string
          updated_by?: string | null
          variables?: Json
        }
        Relationships: [
          {
            foreignKeyName: "notification_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          grievance_ticket_id: string | null
          id: string
          link_path: string | null
          order_id: string | null
          payload: Json
          provider_message_id: string | null
          read_at: string | null
          restaurant_id: string | null
          status: string
          template: string
          title: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          channel?: string
          created_at?: string
          grievance_ticket_id?: string | null
          id?: string
          link_path?: string | null
          order_id?: string | null
          payload?: Json
          provider_message_id?: string | null
          read_at?: string | null
          restaurant_id?: string | null
          status?: string
          template: string
          title?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          grievance_ticket_id?: string | null
          id?: string
          link_path?: string | null
          order_id?: string | null
          payload?: Json
          provider_message_id?: string | null
          read_at?: string | null
          restaurant_id?: string | null
          status?: string
          template?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_grievance_ticket_id_fkey"
            columns: ["grievance_ticket_id"]
            isOneToOne: false
            referencedRelation: "grievance_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      operational_alert_acks: {
        Row: {
          acknowledged_by: string
          alert_type: string
          cleared_at: string | null
          cleared_by: string | null
          created_at: string
          id: string
          note: string | null
          restaurant_id: string | null
          target_id: string | null
          target_table: string | null
        }
        Insert: {
          acknowledged_by: string
          alert_type: string
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          restaurant_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Update: {
          acknowledged_by?: string
          alert_type?: string
          cleared_at?: string | null
          cleared_by?: string | null
          created_at?: string
          id?: string
          note?: string | null
          restaurant_id?: string | null
          target_id?: string | null
          target_table?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "operational_alert_acks_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_alert_acks_cleared_by_fkey"
            columns: ["cleared_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operational_alert_acks_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          id: string
          name_snapshot: string
          order_id: string
          price_snapshot_paise: number
          product_id: string | null
          quantity: number
        }
        Insert: {
          id?: string
          name_snapshot: string
          order_id: string
          price_snapshot_paise: number
          product_id?: string | null
          quantity: number
        }
        Update: {
          id?: string
          name_snapshot?: string
          order_id?: string
          price_snapshot_paise?: number
          product_id?: string | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancel_penalty_amount_paise: number | null
          cancel_penalty_rate: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          collected_at: string | null
          commission_amount_paise: number | null
          commission_rate_snapshot: number | null
          created_at: string
          customer_id: string
          group_id: string | null
          id: string
          no_show_at: string | null
          pickup_time: string | null
          ready_at: string | null
          ready_source: string | null
          restaurant_id: string
          scan_token: string
          status: Database["public"]["Enums"]["order_status"]
          subtotal_paise: number
          updated_at: string
          vendor_payable_paise: number | null
        }
        Insert: {
          cancel_penalty_amount_paise?: number | null
          cancel_penalty_rate?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          collected_at?: string | null
          commission_amount_paise?: number | null
          commission_rate_snapshot?: number | null
          created_at?: string
          customer_id: string
          group_id?: string | null
          id?: string
          no_show_at?: string | null
          pickup_time?: string | null
          ready_at?: string | null
          ready_source?: string | null
          restaurant_id: string
          scan_token?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_paise: number
          updated_at?: string
          vendor_payable_paise?: number | null
        }
        Update: {
          cancel_penalty_amount_paise?: number | null
          cancel_penalty_rate?: number | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          collected_at?: string | null
          commission_amount_paise?: number | null
          commission_rate_snapshot?: number | null
          created_at?: string
          customer_id?: string
          group_id?: string | null
          id?: string
          no_show_at?: string | null
          pickup_time?: string | null
          ready_at?: string | null
          ready_source?: string | null
          restaurant_id?: string
          scan_token?: string
          status?: Database["public"]["Enums"]["order_status"]
          subtotal_paise?: number
          updated_at?: string
          vendor_payable_paise?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "multi_order_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          payload: Json
          payment_id: string | null
          provider_event_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          payload: Json
          payment_id?: string | null
          provider_event_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          payment_id?: string | null
          provider_event_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_paise: number
          created_at: string
          customer_id: string
          // `group_id uuid not null` per 0003_ordering_and_financial_tables.sql —
          // the generator marks it nullable because it's a nullable FK target
          // shape upstream, but every payments row genuinely has one.
          group_id: string
          id: string
          razorpay_order_id: string | null
          razorpay_payment_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          customer_id: string
          group_id?: string | null
          id?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          customer_id?: string
          group_id?: string | null
          id?: string
          razorpay_order_id?: string | null
          razorpay_payment_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "multi_order_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_capacity_overrides: {
        Row: {
          capacity: number
          created_at: string
          day_of_week: number | null
          id: string
          restaurant_id: string
          slot_start: string
          specific_date: string | null
        }
        Insert: {
          capacity: number
          created_at?: string
          day_of_week?: number | null
          id?: string
          restaurant_id: string
          slot_start: string
          specific_date?: string | null
        }
        Update: {
          capacity?: number
          created_at?: string
          day_of_week?: number | null
          id?: string
          restaurant_id?: string
          slot_start?: string
          specific_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pickup_capacity_overrides_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_sequences: {
        Row: {
          created_at: string
          group_id: string
          id: string
          mode: Database["public"]["Enums"]["pickup_mode"]
          pickup_time: string
          restaurant_id: string
          sequence_no: number
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          mode: Database["public"]["Enums"]["pickup_mode"]
          pickup_time: string
          restaurant_id: string
          sequence_no: number
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          mode?: Database["public"]["Enums"]["pickup_mode"]
          pickup_time?: string
          restaurant_id?: string
          sequence_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "pickup_sequences_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "multi_order_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pickup_sequences_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          created_at: string
          id: string
          is_visible: boolean
          name: string
          restaurant_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_visible?: boolean
          name: string
          restaurant_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_visible?: boolean
          name?: string
          restaurant_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          archived_at: string | null
          availability: Database["public"]["Enums"]["product_availability"]
          category_id: string | null
          cook_time_minutes: number | null
          created_at: string
          description: string | null
          id: string
          image_path: string | null
          inventory_mode: Database["public"]["Enums"]["inventory_mode"]
          is_visible: boolean
          name: string
          price_paise: number
          restaurant_id: string
          sort_order: number
          stock_quantity: number | null
        }
        Insert: {
          archived_at?: string | null
          availability?: Database["public"]["Enums"]["product_availability"]
          category_id?: string | null
          cook_time_minutes?: number | null
          created_at?: string
          description?: string | null
          id?: string
          image_path?: string | null
          inventory_mode?: Database["public"]["Enums"]["inventory_mode"]
          is_visible?: boolean
          name: string
          price_paise: number
          restaurant_id: string
          sort_order?: number
          stock_quantity?: number | null
        }
        Update: {
          archived_at?: string | null
          availability?: Database["public"]["Enums"]["product_availability"]
          category_id?: string | null
          cook_time_minutes?: number | null
          created_at?: string
          description?: string | null
          id?: string
          image_path?: string | null
          inventory_mode?: Database["public"]["Enums"]["inventory_mode"]
          is_visible?: boolean
          name?: string
          price_paise?: number
          restaurant_id?: string
          sort_order?: number
          stock_quantity?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          course: string | null
          created_at: string
          email: string | null
          id: string
          name: string | null
          phone: string | null
          role: Database["public"]["Enums"]["app_role"]
          status: string
          updated_at: string
        }
        Insert: {
          course?: string | null
          created_at?: string
          email?: string | null
          id: string
          name?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
        }
        Update: {
          course?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          comment: string | null
          created_at: string
          customer_id: string
          id: string
          order_id: string
          restaurant_id: string
          stars: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          customer_id: string
          id?: string
          order_id: string
          restaurant_id: string
          stars: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          order_id?: string
          restaurant_id?: string
          stars?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_events: {
        Row: {
          amount_paise: number
          created_at: string
          decided_by: string | null
          grievance_ticket_id: string | null
          id: string
          order_id: string
          payment_id: string | null
          razorpay_refund_id: string | null
          requested_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          decided_by?: string | null
          grievance_ticket_id?: string | null
          id?: string
          order_id: string
          payment_id?: string | null
          razorpay_refund_id?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          decided_by?: string | null
          grievance_ticket_id?: string | null
          id?: string
          order_id?: string
          payment_id?: string | null
          razorpay_refund_id?: string | null
          requested_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refund_events_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_events_grievance_ticket_fk"
            columns: ["grievance_ticket_id"]
            isOneToOne: false
            referencedRelation: "grievance_tickets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_events_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_events_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_cancellation_events: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          order_id: string
          penalty_amount_paise: number
          penalty_rate: number
          reason: string
          restaurant_id: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          order_id: string
          penalty_amount_paise: number
          penalty_rate: number
          reason: string
          restaurant_id: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          order_id?: string
          penalty_amount_paise?: number
          penalty_rate?: number
          reason?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_cancellation_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_cancellation_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_cancellation_events_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_hour_exceptions: {
        Row: {
          closes_at: string | null
          exception_date: string
          id: string
          is_closed: boolean
          note: string | null
          opens_at: string | null
          restaurant_id: string
        }
        Insert: {
          closes_at?: string | null
          exception_date: string
          id?: string
          is_closed?: boolean
          note?: string | null
          opens_at?: string | null
          restaurant_id: string
        }
        Update: {
          closes_at?: string | null
          exception_date?: string
          id?: string
          is_closed?: boolean
          note?: string | null
          opens_at?: string | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_hour_exceptions_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_hours: {
        Row: {
          closes_at: string | null
          day_of_week: number
          id: string
          is_closed: boolean
          opens_at: string | null
          restaurant_id: string
        }
        Insert: {
          closes_at?: string | null
          day_of_week: number
          id?: string
          is_closed?: boolean
          opens_at?: string | null
          restaurant_id: string
        }
        Update: {
          closes_at?: string | null
          day_of_week?: number
          id?: string
          is_closed?: boolean
          opens_at?: string | null
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_hours_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_staff: {
        Row: {
          created_at: string
          disabled_at: string | null
          id: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          id?: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          id?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "restaurant_staff_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "restaurant_staff_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurants: {
        Row: {
          archived_at: string | null
          closed_at: string | null
          closed_reason: string | null
          created_at: string
          default_slot_capacity: number
          description: string | null
          grace_period_minutes: number
          id: string
          location: string | null
          location_type: Database["public"]["Enums"]["restaurant_location_type"]
          logo_path: string | null
          name: string
          paused_reason: string | null
          paused_until: string | null
          pickup_slot_interval_minutes: number
          preparation_default_minutes: number
          slug: string
          status: Database["public"]["Enums"]["restaurant_status"]
          status_changed_at: string | null
          status_changed_by: string | null
          university_place_name: string | null
        }
        Insert: {
          archived_at?: string | null
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string
          default_slot_capacity?: number
          description?: string | null
          grace_period_minutes?: number
          id?: string
          location?: string | null
          location_type?: Database["public"]["Enums"]["restaurant_location_type"]
          logo_path?: string | null
          name: string
          paused_reason?: string | null
          paused_until?: string | null
          pickup_slot_interval_minutes?: number
          preparation_default_minutes?: number
          slug: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          status_changed_at?: string | null
          status_changed_by?: string | null
          university_place_name?: string | null
        }
        Update: {
          archived_at?: string | null
          closed_at?: string | null
          closed_reason?: string | null
          created_at?: string
          default_slot_capacity?: number
          description?: string | null
          grace_period_minutes?: number
          id?: string
          location?: string | null
          location_type?: Database["public"]["Enums"]["restaurant_location_type"]
          logo_path?: string | null
          name?: string
          paused_reason?: string | null
          paused_until?: string | null
          pickup_slot_interval_minutes?: number
          preparation_default_minutes?: number
          slug?: string
          status?: Database["public"]["Enums"]["restaurant_status"]
          status_changed_at?: string | null
          status_changed_by?: string | null
          university_place_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "restaurants_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_provider_events: {
        Row: {
          created_at: string
          error_code: string | null
          error_message: string | null
          id: string
          notification_id: string | null
          payload: Json
          provider: string
          provider_message_id: string | null
          status: string
          template: string | null
          to_phone_masked: string | null
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          notification_id?: string | null
          payload?: Json
          provider: string
          provider_message_id?: string | null
          status?: string
          template?: string | null
          to_phone_masked?: string | null
        }
        Update: {
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          notification_id?: string | null
          payload?: Json
          provider?: string
          provider_message_id?: string | null
          status?: string
          template?: string | null
          to_phone_masked?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_provider_events_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_admin_memberships: {
        Row: {
          created_at: string
          disabled_at: string | null
          id: string
          restaurant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          disabled_at?: string | null
          id?: string
          restaurant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          disabled_at?: string | null
          id?: string
          restaurant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_admin_memberships_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_admin_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      vendor_payables: {
        Row: {
          amount_paise: number
          created_at: string
          disbursed_amount_paise: number
          id: string
          order_id: string
          restaurant_id: string
        }
        Insert: {
          amount_paise: number
          created_at?: string
          disbursed_amount_paise?: number
          id?: string
          order_id: string
          restaurant_id: string
        }
        Update: {
          amount_paise?: number
          created_at?: string
          disbursed_amount_paise?: number
          id?: string
          order_id?: string
          restaurant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendor_payables_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vendor_payables_restaurant_id_fkey"
            columns: ["restaurant_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
      walking_times: {
        Row: {
          id: string
          minutes: number
          restaurant_from_id: string
          restaurant_to_id: string
          updated_at: string
        }
        Insert: {
          id?: string
          minutes: number
          restaurant_from_id: string
          restaurant_to_id: string
          updated_at?: string
        }
        Update: {
          id?: string
          minutes?: number
          restaurant_from_id?: string
          restaurant_to_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "walking_times_restaurant_from_id_fkey"
            columns: ["restaurant_from_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "walking_times_restaurant_to_id_fkey"
            columns: ["restaurant_to_id"]
            isOneToOne: false
            referencedRelation: "restaurants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      force_logout_user: {
        Args: { target_user_id: string }
        Returns: undefined
      }
      is_active_staff_for: {
        Args: { target_restaurant_id: string }
        Returns: boolean
      }
      is_active_vendor_admin_for: {
        Args: { target_restaurant_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: never; Returns: boolean }
      my_restaurant_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      app_role: "customer" | "vendor_admin" | "staff" | "super_admin"
      disbursement_status:
        | "pending"
        | "paid"
        | "acknowledged_received"
        | "acknowledged_not_received"
      grievance_category:
        | "payment"
        | "refund"
        | "wrong_item"
        | "missing_item"
        | "pickup"
        | "qr"
        | "vendor_issue"
        | "staff_issue"
        | "product_issue"
        | "account"
        | "technical"
        | "other"
      grievance_priority: "low" | "normal" | "high" | "urgent"
      grievance_role: "customer" | "vendor"
      grievance_status:
        | "open"
        | "in_review"
        | "waiting_customer"
        | "waiting_vendor"
        | "escalated"
        | "resolved"
        | "closed"
      inventory_mode: "boolean" | "quantity"
      order_status:
        | "cart"
        | "payment_pending"
        | "paid"
        | "scheduled"
        | "preparing"
        | "ready_for_pickup"
        | "collected"
        | "cancelled"
        | "refund_pending"
        | "refunded"
        | "no_show"
      payment_status:
        | "created"
        | "authorized"
        | "captured"
        | "failed"
        | "refunded"
      pickup_mode: "fixed_time" | "immediately_after"
      product_availability: "available" | "out_of_stock"
      restaurant_location_type: "inside_university" | "outside_university"
      restaurant_status: "active" | "paused" | "closed" | "archived"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["customer", "vendor_admin", "staff", "super_admin"],
      disbursement_status: [
        "pending",
        "paid",
        "acknowledged_received",
        "acknowledged_not_received",
      ],
      grievance_category: [
        "payment",
        "refund",
        "wrong_item",
        "missing_item",
        "pickup",
        "qr",
        "vendor_issue",
        "staff_issue",
        "product_issue",
        "account",
        "technical",
        "other",
      ],
      grievance_priority: ["low", "normal", "high", "urgent"],
      grievance_role: ["customer", "vendor"],
      grievance_status: [
        "open",
        "in_review",
        "waiting_customer",
        "waiting_vendor",
        "escalated",
        "resolved",
        "closed",
      ],
      inventory_mode: ["boolean", "quantity"],
      order_status: [
        "cart",
        "payment_pending",
        "paid",
        "scheduled",
        "preparing",
        "ready_for_pickup",
        "collected",
        "cancelled",
        "refund_pending",
        "refunded",
        "no_show",
      ],
      payment_status: [
        "created",
        "authorized",
        "captured",
        "failed",
        "refunded",
      ],
      pickup_mode: ["fixed_time", "immediately_after"],
      product_availability: ["available", "out_of_stock"],
      restaurant_location_type: ["inside_university", "outside_university"],
      restaurant_status: ["active", "paused", "closed", "archived"],
    },
  },
} as const
