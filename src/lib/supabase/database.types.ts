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
      affiliate_attributions: {
        Row: {
          affiliate_link_id: string
          affiliate_membership_id: string
          attributed_at: string
          campaign: string | null
          expires_at: string
          id: string
          metadata: Json
          order_id: string | null
          ref_code: string
          visitor_key_hash: string | null
        }
        Insert: {
          affiliate_link_id: string
          affiliate_membership_id: string
          attributed_at?: string
          campaign?: string | null
          expires_at: string
          id?: string
          metadata?: Json
          order_id?: string | null
          ref_code: string
          visitor_key_hash?: string | null
        }
        Update: {
          affiliate_link_id?: string
          affiliate_membership_id?: string
          attributed_at?: string
          campaign?: string | null
          expires_at?: string
          id?: string
          metadata?: Json
          order_id?: string | null
          ref_code?: string
          visitor_key_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_attributions_affiliate_link_id_fkey"
            columns: ["affiliate_link_id"]
            isOneToOne: false
            referencedRelation: "affiliate_links"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_attributions_affiliate_membership_id_fkey"
            columns: ["affiliate_membership_id"]
            isOneToOne: false
            referencedRelation: "affiliate_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_attributions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_links: {
        Row: {
          active: boolean
          campaign: string | null
          created_at: string
          id: string
          membership_id: string
          offer_id: string | null
          ref_code: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          campaign?: string | null
          created_at?: string
          id?: string
          membership_id: string
          offer_id?: string | null
          ref_code: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          campaign?: string | null
          created_at?: string
          id?: string
          membership_id?: string
          offer_id?: string | null
          ref_code?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_links_membership_id_fkey"
            columns: ["membership_id"]
            isOneToOne: false
            referencedRelation: "affiliate_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_links_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_memberships: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          code: string
          created_at: string
          id: string
          invited_by: string | null
          program_id: string
          status: Database["public"]["Enums"]["membership_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          code: string
          created_at?: string
          id?: string
          invited_by?: string | null
          program_id: string
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          code?: string
          created_at?: string
          id?: string
          invited_by?: string | null
          program_id?: string
          status?: Database["public"]["Enums"]["membership_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_memberships_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_memberships_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_memberships_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "affiliate_programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_programs: {
        Row: {
          active: boolean
          cookie_days: number
          created_at: string
          id: string
          mode: Database["public"]["Enums"]["affiliate_program_mode"]
          product_id: string
          terms: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          cookie_days?: number
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["affiliate_program_mode"]
          product_id: string
          terms?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          cookie_days?: number
          created_at?: string
          id?: string
          mode?: Database["public"]["Enums"]["affiliate_program_mode"]
          product_id?: string
          terms?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_programs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          allocation_id: string
          amount_cents: number
          available_at: string
          beneficiary_user_id: string
          commission_type: Database["public"]["Enums"]["allocation_type"]
          created_at: string
          currency: string
          id: string
          paid_at: string | null
          payment_id: string
          reversed_at: string | null
          status: Database["public"]["Enums"]["commission_status"]
          updated_at: string
        }
        Insert: {
          allocation_id: string
          amount_cents: number
          available_at: string
          beneficiary_user_id: string
          commission_type: Database["public"]["Enums"]["allocation_type"]
          created_at?: string
          currency: string
          id?: string
          paid_at?: string | null
          payment_id: string
          reversed_at?: string | null
          status?: Database["public"]["Enums"]["commission_status"]
          updated_at?: string
        }
        Update: {
          allocation_id?: string
          amount_cents?: number
          available_at?: string
          beneficiary_user_id?: string
          commission_type?: Database["public"]["Enums"]["allocation_type"]
          created_at?: string
          currency?: string
          id?: string
          paid_at?: string | null
          payment_id?: string
          reversed_at?: string | null
          status?: Database["public"]["Enums"]["commission_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commissions_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: true
            referencedRelation: "financial_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_beneficiary_user_id_fkey"
            columns: ["beneficiary_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      coproducer_invitations: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          invited_by: string
          invited_email: string
          invited_user_id: string | null
          offer_id: string | null
          participation_bps: number
          product_id: string
          responded_at: string | null
          status: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          invited_by: string
          invited_email: string
          invited_user_id?: string | null
          offer_id?: string | null
          participation_bps: number
          product_id: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          invited_by?: string
          invited_email?: string
          invited_user_id?: string | null
          offer_id?: string | null
          participation_bps?: number
          product_id?: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["invitation_status"]
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coproducer_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coproducer_invitations_invited_user_id_fkey"
            columns: ["invited_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coproducer_invitations_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coproducer_invitations_offer_product_fk"
            columns: ["offer_id", "product_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "coproducer_invitations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          document_hash: string | null
          email: string
          external_customer_id: string | null
          id: string
          metadata: Json
          name: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_hash?: string | null
          email: string
          external_customer_id?: string | null
          id?: string
          metadata?: Json
          name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_hash?: string | null
          email?: string
          external_customer_id?: string | null
          id?: string
          metadata?: Json
          name?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      disputes: {
        Row: {
          amount_cents: number
          closed_at: string | null
          created_at: string
          external_dispute_id: string
          id: string
          opened_at: string
          payment_id: string
          raw_provider_data: Json
          reason: string | null
          status: Database["public"]["Enums"]["dispute_status"]
          updated_at: string
        }
        Insert: {
          amount_cents: number
          closed_at?: string | null
          created_at?: string
          external_dispute_id: string
          id?: string
          opened_at: string
          payment_id: string
          raw_provider_data?: Json
          reason?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          closed_at?: string | null
          created_at?: string
          external_dispute_id?: string
          id?: string
          opened_at?: string
          payment_id?: string
          raw_provider_data?: Json
          reason?: string | null
          status?: Database["public"]["Enums"]["dispute_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "disputes_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_allocations: {
        Row: {
          allocation_type: Database["public"]["Enums"]["allocation_type"]
          amount_cents: number
          beneficiary_user_id: string | null
          created_at: string
          currency: string
          destination: Database["public"]["Enums"]["allocation_destination"]
          id: string
          rule_snapshot: Json
          snapshot_id: string
        }
        Insert: {
          allocation_type: Database["public"]["Enums"]["allocation_type"]
          amount_cents: number
          beneficiary_user_id?: string | null
          created_at?: string
          currency: string
          destination: Database["public"]["Enums"]["allocation_destination"]
          id?: string
          rule_snapshot?: Json
          snapshot_id: string
        }
        Update: {
          allocation_type?: Database["public"]["Enums"]["allocation_type"]
          amount_cents?: number
          beneficiary_user_id?: string | null
          created_at?: string
          currency?: string
          destination?: Database["public"]["Enums"]["allocation_destination"]
          id?: string
          rule_snapshot?: Json
          snapshot_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_allocations_beneficiary_user_id_fkey"
            columns: ["beneficiary_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financial_allocations_snapshot_id_fkey"
            columns: ["snapshot_id"]
            isOneToOne: false
            referencedRelation: "financial_snapshots"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_snapshots: {
        Row: {
          affiliate_amount_cents: number
          calculation_version: number
          coproducer_amount_cents: number
          created_at: string
          currency: string
          gateway_fee_amount_cents: number
          gross_amount_cents: number
          id: string
          order_id: string
          producer_amount_cents: number
          prosperity_fee_amount_cents: number
          prosperity_split_amount_cents: number
          rules: Json
          settlement_model: Database["public"]["Enums"]["settlement_model"]
        }
        Insert: {
          affiliate_amount_cents?: number
          calculation_version?: number
          coproducer_amount_cents?: number
          created_at?: string
          currency: string
          gateway_fee_amount_cents?: number
          gross_amount_cents: number
          id?: string
          order_id: string
          producer_amount_cents: number
          prosperity_fee_amount_cents: number
          prosperity_split_amount_cents: number
          rules: Json
          settlement_model: Database["public"]["Enums"]["settlement_model"]
        }
        Update: {
          affiliate_amount_cents?: number
          calculation_version?: number
          coproducer_amount_cents?: number
          created_at?: string
          currency?: string
          gateway_fee_amount_cents?: number
          gross_amount_cents?: number
          id?: string
          order_id?: string
          producer_amount_cents?: number
          prosperity_fee_amount_cents?: number
          prosperity_split_amount_cents?: number
          rules?: Json
          settlement_model?: Database["public"]["Enums"]["settlement_model"]
        }
        Relationships: [
          {
            foreignKeyName: "financial_snapshots_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_documents: {
        Row: {
          created_at: string
          document_type: string
          id: string
          storage_bucket: string
          storage_path: string
          verification_id: string
        }
        Insert: {
          created_at?: string
          document_type: string
          id?: string
          storage_bucket: string
          storage_path: string
          verification_id: string
        }
        Update: {
          created_at?: string
          document_type?: string
          id?: string
          storage_bucket?: string
          storage_path?: string
          verification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_documents_verification_id_fkey"
            columns: ["verification_id"]
            isOneToOne: false
            referencedRelation: "identity_verifications"
            referencedColumns: ["id"]
          },
        ]
      }
      identity_verifications: {
        Row: {
          birth_date: string | null
          business_name: string | null
          created_at: string
          id: string
          legal_name: string
          person_type: string
          review_note: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          status: Database["public"]["Enums"]["identity_verification_status"]
          submitted_at: string
          tax_id_hash: string
          tax_id_last4: string
          updated_at: string
          user_id: string
        }
        Insert: {
          birth_date?: string | null
          business_name?: string | null
          created_at?: string
          id?: string
          legal_name: string
          person_type: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["identity_verification_status"]
          submitted_at?: string
          tax_id_hash: string
          tax_id_last4: string
          updated_at?: string
          user_id: string
        }
        Update: {
          birth_date?: string | null
          business_name?: string | null
          created_at?: string
          id?: string
          legal_name?: string
          person_type?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          status?: Database["public"]["Enums"]["identity_verification_status"]
          submitted_at?: string
          tax_id_hash?: string
          tax_id_last4?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_verifications_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_verifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_accounts: {
        Row: {
          account_type: Database["public"]["Enums"]["ledger_account_type"]
          created_at: string
          currency: string
          id: string
          user_id: string | null
        }
        Insert: {
          account_type: Database["public"]["Enums"]["ledger_account_type"]
          created_at?: string
          currency?: string
          id?: string
          user_id?: string | null
        }
        Update: {
          account_type?: Database["public"]["Enums"]["ledger_account_type"]
          created_at?: string
          currency?: string
          id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          account_id: string
          amount_cents: number
          available_at: string
          created_at: string
          currency: string
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id: string
          metadata: Json
          order_id: string | null
          payment_id: string | null
          reference: string
          settlement_model: Database["public"]["Enums"]["settlement_model"]
          source_id: string
          source_type: string
          status: Database["public"]["Enums"]["ledger_entry_status"]
        }
        Insert: {
          account_id: string
          amount_cents: number
          available_at?: string
          created_at?: string
          currency: string
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id?: string
          metadata?: Json
          order_id?: string | null
          payment_id?: string | null
          reference: string
          settlement_model: Database["public"]["Enums"]["settlement_model"]
          source_id: string
          source_type: string
          status?: Database["public"]["Enums"]["ledger_entry_status"]
        }
        Update: {
          account_id?: string
          amount_cents?: number
          available_at?: string
          created_at?: string
          currency?: string
          entry_type?: Database["public"]["Enums"]["ledger_entry_type"]
          id?: string
          metadata?: Json
          order_id?: string | null
          payment_id?: string | null
          reference?: string
          settlement_model?: Database["public"]["Enums"]["settlement_model"]
          source_id?: string
          source_type?: string
          status?: Database["public"]["Enums"]["ledger_entry_status"]
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "ledger_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      offers: {
        Row: {
          affiliate_commission_bps: number
          affiliate_commission_fixed_cents: number
          affiliate_commission_type: Database["public"]["Enums"]["fee_type"]
          affiliate_hold_days: number
          affiliate_recurrence_cycles: number | null
          affiliate_recurrence_mode: Database["public"]["Enums"]["recurrence_mode"]
          billing_interval: string | null
          billing_interval_count: number | null
          billing_type: Database["public"]["Enums"]["billing_type"]
          checkout_slug: string
          created_at: string
          currency: string
          id: string
          max_installments: number
          metadata: Json
          name: string
          price_cents: number
          product_id: string
          prosperity_fee_bps: number | null
          prosperity_fee_fixed_cents: number | null
          prosperity_fee_type: Database["public"]["Enums"]["fee_type"] | null
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          affiliate_commission_bps?: number
          affiliate_commission_fixed_cents?: number
          affiliate_commission_type?: Database["public"]["Enums"]["fee_type"]
          affiliate_hold_days?: number
          affiliate_recurrence_cycles?: number | null
          affiliate_recurrence_mode?: Database["public"]["Enums"]["recurrence_mode"]
          billing_interval?: string | null
          billing_interval_count?: number | null
          billing_type?: Database["public"]["Enums"]["billing_type"]
          checkout_slug: string
          created_at?: string
          currency?: string
          id?: string
          max_installments?: number
          metadata?: Json
          name: string
          price_cents: number
          product_id: string
          prosperity_fee_bps?: number | null
          prosperity_fee_fixed_cents?: number | null
          prosperity_fee_type?: Database["public"]["Enums"]["fee_type"] | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          affiliate_commission_bps?: number
          affiliate_commission_fixed_cents?: number
          affiliate_commission_type?: Database["public"]["Enums"]["fee_type"]
          affiliate_hold_days?: number
          affiliate_recurrence_cycles?: number | null
          affiliate_recurrence_mode?: Database["public"]["Enums"]["recurrence_mode"]
          billing_interval?: string | null
          billing_interval_count?: number | null
          billing_type?: Database["public"]["Enums"]["billing_type"]
          checkout_slug?: string
          created_at?: string
          currency?: string
          id?: string
          max_installments?: number
          metadata?: Json
          name?: string
          price_cents?: number
          product_id?: string
          prosperity_fee_bps?: number | null
          prosperity_fee_fixed_cents?: number | null
          prosperity_fee_type?: Database["public"]["Enums"]["fee_type"] | null
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "offers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancelled_at: string | null
          created_at: string
          currency: string
          customer_id: string
          gross_amount_cents: number
          id: string
          idempotency_key: string
          offer_id: string
          order_number: number
          paid_at: string | null
          producer_id: string
          product_id: string
          settlement_model: Database["public"]["Enums"]["settlement_model"]
          status: Database["public"]["Enums"]["order_status"]
          updated_at: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          customer_id: string
          gross_amount_cents: number
          id?: string
          idempotency_key: string
          offer_id: string
          order_number?: never
          paid_at?: string | null
          producer_id: string
          product_id: string
          settlement_model: Database["public"]["Enums"]["settlement_model"]
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          customer_id?: string
          gross_amount_cents?: number
          id?: string
          idempotency_key?: string
          offer_id?: string
          order_number?: never
          paid_at?: string | null
          producer_id?: string
          product_id?: string
          settlement_model?: Database["public"]["Enums"]["settlement_model"]
          status?: Database["public"]["Enums"]["order_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_offer_product_fk"
            columns: ["offer_id", "product_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "orders_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_provider_checkouts: {
        Row: {
          checkout_url: string | null
          connection_id: string
          created_at: string
          expires_at: string | null
          external_checkout_id: string | null
          id: string
          idempotency_key: string
          order_id: string
          provider_id: string
          updated_at: string
        }
        Insert: {
          checkout_url?: string | null
          connection_id: string
          created_at?: string
          expires_at?: string | null
          external_checkout_id?: string | null
          id?: string
          idempotency_key: string
          order_id: string
          provider_id: string
          updated_at?: string
        }
        Update: {
          checkout_url?: string | null
          connection_id?: string
          created_at?: string
          expires_at?: string | null
          external_checkout_id?: string | null
          id?: string
          idempotency_key?: string
          order_id?: string
          provider_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_provider_checkouts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_provider_checkouts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_provider_checkouts_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_provider_connections: {
        Row: {
          connected_at: string
          connection_kind: Database["public"]["Enums"]["settlement_model"]
          created_at: string
          external_account_id: string
          id: string
          live_mode: boolean
          metadata: Json
          owner_user_id: string | null
          provider_id: string
          public_key: string | null
          revoked_at: string | null
          scopes: string[]
          status: string
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          connected_at?: string
          connection_kind: Database["public"]["Enums"]["settlement_model"]
          created_at?: string
          external_account_id: string
          id?: string
          live_mode?: boolean
          metadata?: Json
          owner_user_id?: string | null
          provider_id: string
          public_key?: string | null
          revoked_at?: string | null
          scopes?: string[]
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          connected_at?: string
          connection_kind?: Database["public"]["Enums"]["settlement_model"]
          created_at?: string
          external_account_id?: string
          id?: string
          live_mode?: boolean
          metadata?: Json
          owner_user_id?: string | null
          provider_id?: string
          public_key?: string | null
          revoked_at?: string | null
          scopes?: string[]
          status?: string
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_provider_connections_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_provider_connections_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_providers: {
        Row: {
          active: boolean
          code: string
          created_at: string
          id: string
          metadata: Json
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          code: string
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          code?: string
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          amount_cents: number | null
          created_at: string
          id: string
          occurred_at: string | null
          payment_id: string
          provider_event_id: string | null
          raw_payload: Json
          status: string | null
          transaction_type: string
        }
        Insert: {
          amount_cents?: number | null
          created_at?: string
          id?: string
          occurred_at?: string | null
          payment_id: string
          provider_event_id?: string | null
          raw_payload?: Json
          status?: string | null
          transaction_type: string
        }
        Update: {
          amount_cents?: number | null
          created_at?: string
          id?: string
          occurred_at?: string | null
          payment_id?: string
          provider_event_id?: string | null
          raw_payload?: Json
          status?: string | null
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          connection_id: string
          created_at: string
          currency: string
          external_payment_id: string | null
          external_reference: string
          gross_amount_cents: number
          id: string
          idempotency_key: string
          order_id: string
          paid_at: string | null
          provider_fee_amount_cents: number
          provider_id: string
          raw_provider_data: Json
          refunded_at: string | null
          status: Database["public"]["Enums"]["payment_status"]
          status_detail: string | null
          updated_at: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          currency?: string
          external_payment_id?: string | null
          external_reference: string
          gross_amount_cents: number
          id?: string
          idempotency_key: string
          order_id: string
          paid_at?: string | null
          provider_fee_amount_cents?: number
          provider_id: string
          raw_provider_data?: Json
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          status_detail?: string | null
          updated_at?: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          currency?: string
          external_payment_id?: string | null
          external_reference?: string
          gross_amount_cents?: number
          id?: string
          idempotency_key?: string
          order_id?: string
          paid_at?: string | null
          provider_fee_amount_cents?: number
          provider_id?: string
          raw_provider_data?: Json
          refunded_at?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          status_detail?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payments_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "payment_provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      payout_accounts: {
        Row: {
          created_at: string
          encrypted_key: string
          holder_name: string
          holder_tax_id_last4: string
          id: string
          is_primary: boolean
          key_hash: string
          key_last4: string
          key_type: Database["public"]["Enums"]["payout_account_type"]
          status: Database["public"]["Enums"]["payout_account_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_key: string
          holder_name: string
          holder_tax_id_last4: string
          id?: string
          is_primary?: boolean
          key_hash: string
          key_last4: string
          key_type: Database["public"]["Enums"]["payout_account_type"]
          status?: Database["public"]["Enums"]["payout_account_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_key?: string
          holder_name?: string
          holder_tax_id_last4?: string
          id?: string
          is_primary?: boolean
          key_hash?: string
          key_last4?: string
          key_type?: Database["public"]["Enums"]["payout_account_type"]
          status?: Database["public"]["Enums"]["payout_account_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payout_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_participants: {
        Row: {
          active: boolean
          created_at: string
          id: string
          invitation_id: string | null
          offer_id: string | null
          participation_bps: number
          product_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          invitation_id?: string | null
          offer_id?: string | null
          participation_bps: number
          product_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          invitation_id?: string | null
          offer_id?: string | null
          participation_bps?: number
          product_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_participants_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "coproducer_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_participants_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_participants_offer_product_fk"
            columns: ["offer_id", "product_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id", "product_id"]
          },
          {
            foreignKeyName: "product_participants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          id: string
          image_path: string | null
          name: string
          producer_id: string
          prosperity_fee_bps: number
          prosperity_fee_fixed_cents: number
          prosperity_fee_type: Database["public"]["Enums"]["fee_type"]
          settlement_model: Database["public"]["Enums"]["settlement_model"]
          slug: string
          status: Database["public"]["Enums"]["record_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_path?: string | null
          name: string
          producer_id: string
          prosperity_fee_bps?: number
          prosperity_fee_fixed_cents?: number
          prosperity_fee_type?: Database["public"]["Enums"]["fee_type"]
          settlement_model: Database["public"]["Enums"]["settlement_model"]
          slug: string
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_path?: string | null
          name?: string
          producer_id?: string
          prosperity_fee_bps?: number
          prosperity_fee_fixed_cents?: number
          prosperity_fee_type?: Database["public"]["Enums"]["fee_type"]
          settlement_model?: Database["public"]["Enums"]["settlement_model"]
          slug?: string
          status?: Database["public"]["Enums"]["record_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_producer_id_fkey"
            columns: ["producer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          default_settlement_model:
            | Database["public"]["Enums"]["settlement_model"]
            | null
          email: string
          full_name: string
          id: string
          locale: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_settlement_model?:
            | Database["public"]["Enums"]["settlement_model"]
            | null
          email: string
          full_name: string
          id: string
          locale?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_settlement_model?:
            | Database["public"]["Enums"]["settlement_model"]
            | null
          email?: string
          full_name?: string
          id?: string
          locale?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount_cents: number
          created_at: string
          external_refund_id: string | null
          id: string
          idempotency_key: string
          payment_id: string
          raw_provider_data: Json
          reason: string | null
          status: Database["public"]["Enums"]["refund_status"]
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          external_refund_id?: string | null
          id?: string
          idempotency_key: string
          payment_id: string
          raw_provider_data?: Json
          reason?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          external_refund_id?: string | null
          id?: string
          idempotency_key?: string
          payment_id?: string
          raw_provider_data?: Json
          reason?: string | null
          status?: Database["public"]["Enums"]["refund_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          amount_cents: number
          cancelled_at: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          customer_id: string
          cycle_number: number
          external_subscription_id: string | null
          id: string
          offer_id: string
          order_id: string
          provider_id: string
          status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
        }
        Insert: {
          amount_cents: number
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          customer_id: string
          cycle_number?: number
          external_subscription_id?: string | null
          id?: string
          offer_id: string
          order_id: string
          provider_id: string
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          cancelled_at?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          customer_id?: string
          cycle_number?: number
          external_subscription_id?: string | null
          id?: string
          offer_id?: string
          order_id?: string
          provider_id?: string
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          event_type: string | null
          external_event_id: string | null
          external_resource_id: string | null
          id: string
          payload: Json
          payload_hash: string
          processed_at: string | null
          provider_id: string
          status: Database["public"]["Enums"]["webhook_event_status"]
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          event_type?: string | null
          external_event_id?: string | null
          external_resource_id?: string | null
          id?: string
          payload: Json
          payload_hash: string
          processed_at?: string | null
          provider_id: string
          status?: Database["public"]["Enums"]["webhook_event_status"]
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          event_type?: string | null
          external_event_id?: string | null
          external_resource_id?: string | null
          id?: string
          payload?: Json
          payload_hash?: string
          processed_at?: string | null
          provider_id?: string
          status?: Database["public"]["Enums"]["webhook_event_status"]
        }
        Relationships: [
          {
            foreignKeyName: "webhook_events_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          note: string | null
          operator_id: string | null
          paid_at: string | null
          payout_account_id: string
          payout_holder_name: string
          payout_holder_tax_id_last4: string
          payout_key_last4: string
          payout_key_type: Database["public"]["Enums"]["payout_account_type"]
          processed_at: string | null
          receipt_reference: string | null
          requested_at: string
          status: Database["public"]["Enums"]["withdrawal_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          operator_id?: string | null
          paid_at?: string | null
          payout_account_id: string
          payout_holder_name: string
          payout_holder_tax_id_last4: string
          payout_key_last4: string
          payout_key_type: Database["public"]["Enums"]["payout_account_type"]
          processed_at?: string | null
          receipt_reference?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          operator_id?: string | null
          paid_at?: string | null
          payout_account_id?: string
          payout_holder_name?: string
          payout_holder_tax_id_last4?: string
          payout_key_last4?: string
          payout_key_type?: Database["public"]["Enums"]["payout_account_type"]
          processed_at?: string | null
          receipt_reference?: string | null
          requested_at?: string
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_operator_id_fkey"
            columns: ["operator_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_payout_account_id_fkey"
            columns: ["payout_account_id"]
            isOneToOne: false
            referencedRelation: "payout_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "withdrawals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      user_balance_summary: {
        Row: {
          available_cents: number | null
          currency: string | null
          pending_cents: number | null
          total_received_cents: number | null
          user_id: string | null
          withdrawing_cents: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      get_payment_provider_credential: {
        Args: { target_connection_id: string }
        Returns: {
          encrypted_access_token: string
          encrypted_refresh_token: string
        }[]
      }
      is_finance_admin: { Args: never; Returns: boolean }
      owns_product: { Args: { target_product_id: string }; Returns: boolean }
      participates_in_product: {
        Args: { target_product_id: string }
        Returns: boolean
      }
      post_payment_financials: {
        Args: { target_payment_id: string }
        Returns: number
      }
      request_withdrawal: {
        Args: {
          requested_amount_cents: number
          requested_payout_account_id: string
        }
        Returns: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          note: string | null
          operator_id: string | null
          paid_at: string | null
          payout_account_id: string
          payout_holder_name: string
          payout_holder_tax_id_last4: string
          payout_key_last4: string
          payout_key_type: Database["public"]["Enums"]["payout_account_type"]
          processed_at: string | null
          receipt_reference: string | null
          requested_at: string
          status: Database["public"]["Enums"]["withdrawal_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "withdrawals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      transition_withdrawal: {
        Args: {
          target_note?: string
          target_operator_id: string
          target_receipt_reference?: string
          target_status: Database["public"]["Enums"]["withdrawal_status"]
          target_withdrawal_id: string
        }
        Returns: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          note: string | null
          operator_id: string | null
          paid_at: string | null
          payout_account_id: string
          payout_holder_name: string
          payout_holder_tax_id_last4: string
          payout_key_last4: string
          payout_key_type: Database["public"]["Enums"]["payout_account_type"]
          processed_at: string | null
          receipt_reference: string | null
          requested_at: string
          status: Database["public"]["Enums"]["withdrawal_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "withdrawals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_payment_provider_connection: {
        Args: {
          target_connection_kind: Database["public"]["Enums"]["settlement_model"]
          target_encrypted_access_token: string
          target_encrypted_refresh_token: string | null
          target_external_account_id: string
          target_live_mode: boolean
          target_owner_user_id: string | null
          target_public_key: string | null
          target_scopes: string[]
          target_token_expires_at: string | null
        }
        Returns: string
      }
    }
    Enums: {
      affiliate_program_mode: "public" | "approval" | "invite"
      allocation_destination:
        | "internal_balance"
        | "connected_account"
        | "platform_revenue"
        | "gateway"
      allocation_type:
        | "producer"
        | "affiliate"
        | "coproducer"
        | "prosperity_fee"
        | "gateway_fee"
      app_role: "admin" | "finance_operator"
      billing_type: "one_time" | "recurring"
      commission_status:
        | "pending"
        | "available"
        | "paid"
        | "cancelled"
        | "reversed"
      dispute_status: "opened" | "under_review" | "won" | "lost" | "closed"
      fee_type: "percentage" | "fixed" | "hybrid"
      identity_verification_status:
        | "not_submitted"
        | "under_review"
        | "approved"
        | "rejected"
        | "resubmission_required"
      invitation_status:
        | "pending"
        | "accepted"
        | "rejected"
        | "expired"
        | "cancelled"
      ledger_account_type:
        | "user_balance"
        | "platform_revenue"
        | "gateway_expense"
      ledger_entry_status: "posted" | "voided"
      ledger_entry_type:
        | "sale_credit"
        | "affiliate_commission"
        | "coproducer_commission"
        | "prosperity_fee"
        | "gateway_fee"
        | "refund"
        | "chargeback"
        | "withdrawal"
        | "adjustment"
      membership_status:
        | "pending"
        | "active"
        | "rejected"
        | "blocked"
        | "cancelled"
      order_status:
        | "draft"
        | "pending_payment"
        | "paid"
        | "cancelled"
        | "expired"
        | "refunded"
        | "charged_back"
      payment_status:
        | "pending"
        | "processing"
        | "approved"
        | "rejected"
        | "cancelled"
        | "refunded"
        | "charged_back"
      payout_account_status: "pending" | "verified" | "rejected" | "disabled"
      payout_account_type: "cpf" | "cnpj" | "email" | "phone" | "random_key"
      record_status: "draft" | "active" | "inactive" | "archived"
      recurrence_mode:
        | "first_payment"
        | "limited_recurring"
        | "lifetime_recurring"
      refund_status:
        | "pending"
        | "processing"
        | "succeeded"
        | "failed"
        | "cancelled"
      settlement_model: "connected_account" | "prosperity_balance"
      subscription_status:
        | "pending"
        | "active"
        | "past_due"
        | "paused"
        | "cancelled"
        | "expired"
      webhook_event_status:
        | "pending"
        | "processing"
        | "processed"
        | "ignored"
        | "failed"
      withdrawal_status:
        | "requested"
        | "processing"
        | "paid"
        | "rejected"
        | "cancelled"
        | "failed"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      affiliate_program_mode: ["public", "approval", "invite"],
      allocation_destination: [
        "internal_balance",
        "connected_account",
        "platform_revenue",
        "gateway",
      ],
      allocation_type: [
        "producer",
        "affiliate",
        "coproducer",
        "prosperity_fee",
        "gateway_fee",
      ],
      app_role: ["admin", "finance_operator"],
      billing_type: ["one_time", "recurring"],
      commission_status: [
        "pending",
        "available",
        "paid",
        "cancelled",
        "reversed",
      ],
      dispute_status: ["opened", "under_review", "won", "lost", "closed"],
      fee_type: ["percentage", "fixed", "hybrid"],
      identity_verification_status: [
        "not_submitted",
        "under_review",
        "approved",
        "rejected",
        "resubmission_required",
      ],
      invitation_status: [
        "pending",
        "accepted",
        "rejected",
        "expired",
        "cancelled",
      ],
      ledger_account_type: [
        "user_balance",
        "platform_revenue",
        "gateway_expense",
      ],
      ledger_entry_status: ["posted", "voided"],
      ledger_entry_type: [
        "sale_credit",
        "affiliate_commission",
        "coproducer_commission",
        "prosperity_fee",
        "gateway_fee",
        "refund",
        "chargeback",
        "withdrawal",
        "adjustment",
      ],
      membership_status: [
        "pending",
        "active",
        "rejected",
        "blocked",
        "cancelled",
      ],
      order_status: [
        "draft",
        "pending_payment",
        "paid",
        "cancelled",
        "expired",
        "refunded",
        "charged_back",
      ],
      payment_status: [
        "pending",
        "processing",
        "approved",
        "rejected",
        "cancelled",
        "refunded",
        "charged_back",
      ],
      payout_account_status: ["pending", "verified", "rejected", "disabled"],
      payout_account_type: ["cpf", "cnpj", "email", "phone", "random_key"],
      record_status: ["draft", "active", "inactive", "archived"],
      recurrence_mode: [
        "first_payment",
        "limited_recurring",
        "lifetime_recurring",
      ],
      refund_status: [
        "pending",
        "processing",
        "succeeded",
        "failed",
        "cancelled",
      ],
      settlement_model: ["connected_account", "prosperity_balance"],
      subscription_status: [
        "pending",
        "active",
        "past_due",
        "paused",
        "cancelled",
        "expired",
      ],
      webhook_event_status: [
        "pending",
        "processing",
        "processed",
        "ignored",
        "failed",
      ],
      withdrawal_status: [
        "requested",
        "processing",
        "paid",
        "rejected",
        "cancelled",
        "failed",
      ],
    },
  },
} as const
