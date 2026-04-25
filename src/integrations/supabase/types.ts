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
      appointments: {
        Row: {
          amount_paid: number | null
          appointment_date: string
          booking_group_id: string | null
          booking_reference: string | null
          booking_token: string | null
          created_at: string
          customer_id: string | null
          deposit_amount: number | null
          employee_id: string | null
          end_time: string | null
          id: string
          is_demo: boolean
          notes: string | null
          payment_required: boolean | null
          payment_status: string | null
          payment_type: string | null
          price: number | null
          service_id: string | null
          source: string | null
          start_time: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_paid?: number | null
          appointment_date: string
          booking_group_id?: string | null
          booking_reference?: string | null
          booking_token?: string | null
          created_at?: string
          customer_id?: string | null
          deposit_amount?: number | null
          employee_id?: string | null
          end_time?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          payment_required?: boolean | null
          payment_status?: string | null
          payment_type?: string | null
          price?: number | null
          service_id?: string | null
          source?: string | null
          start_time?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_paid?: number | null
          appointment_date?: string
          booking_group_id?: string | null
          booking_reference?: string | null
          booking_token?: string | null
          created_at?: string
          customer_id?: string | null
          deposit_amount?: number | null
          employee_id?: string | null
          end_time?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          payment_required?: boolean | null
          payment_status?: string | null
          payment_type?: string | null
          price?: number | null
          service_id?: string | null
          source?: string | null
          start_time?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          details: Json
          id: string
          is_demo: boolean
          target_id: string | null
          target_type: string
          user_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          is_demo?: boolean
          target_id?: string | null
          target_type: string
          user_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          is_demo?: boolean
          target_id?: string | null
          target_type?: string
          user_id?: string
        }
        Relationships: []
      }
      automation_logs: {
        Row: {
          automation_rule_id: string | null
          automation_run_id: string | null
          created_at: string
          customer_id: string | null
          event_type: string
          id: string
          is_demo: boolean
          message: string
          metadata: Json
          revenue_attributed: number
          status: string
          user_id: string
        }
        Insert: {
          automation_rule_id?: string | null
          automation_run_id?: string | null
          created_at?: string
          customer_id?: string | null
          event_type: string
          id?: string
          is_demo?: boolean
          message?: string
          metadata?: Json
          revenue_attributed?: number
          status?: string
          user_id: string
        }
        Update: {
          automation_rule_id?: string | null
          automation_run_id?: string | null
          created_at?: string
          customer_id?: string | null
          event_type?: string
          id?: string
          is_demo?: boolean
          message?: string
          metadata?: Json
          revenue_attributed?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_logs_automation_rule_id_fkey"
            columns: ["automation_rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automation_logs_automation_run_id_fkey"
            columns: ["automation_run_id"]
            isOneToOne: false
            referencedRelation: "automation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_rules: {
        Row: {
          action_type: string
          booked_count: number
          channel: string
          conditions: Json
          config: Json | null
          created_at: string
          delay_unit: string
          delay_value: number
          description: string
          id: string
          is_active: boolean | null
          is_demo: boolean
          last_triggered_at: string | null
          message_templates: Json
          name: string | null
          provider_required: boolean
          revenue_generated: number
          run_count: number
          sent_count: number
          template_key: string | null
          trigger_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type: string
          booked_count?: number
          channel?: string
          conditions?: Json
          config?: Json | null
          created_at?: string
          delay_unit?: string
          delay_value?: number
          description?: string
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          last_triggered_at?: string | null
          message_templates?: Json
          name?: string | null
          provider_required?: boolean
          revenue_generated?: number
          run_count?: number
          sent_count?: number
          template_key?: string | null
          trigger_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type?: string
          booked_count?: number
          channel?: string
          conditions?: Json
          config?: Json | null
          created_at?: string
          delay_unit?: string
          delay_value?: number
          description?: string
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          last_triggered_at?: string | null
          message_templates?: Json
          name?: string | null
          provider_required?: boolean
          revenue_generated?: number
          run_count?: number
          sent_count?: number
          template_key?: string | null
          trigger_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          appointment_id: string | null
          automation_rule_id: string
          channel: string
          created_at: string
          customer_id: string | null
          error_message: string | null
          id: string
          idempotency_key: string
          is_demo: boolean
          membership_id: string | null
          payload: Json
          payment_id: string | null
          processed_at: string | null
          recipient: string | null
          revenue_attributed: number
          scheduled_for: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_id?: string | null
          automation_rule_id: string
          channel?: string
          created_at?: string
          customer_id?: string | null
          error_message?: string | null
          id?: string
          idempotency_key: string
          is_demo?: boolean
          membership_id?: string | null
          payload?: Json
          payment_id?: string | null
          processed_at?: string | null
          recipient?: string | null
          revenue_attributed?: number
          scheduled_for?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_id?: string | null
          automation_rule_id?: string
          channel?: string
          created_at?: string
          customer_id?: string | null
          error_message?: string | null
          id?: string
          idempotency_key?: string
          is_demo?: boolean
          membership_id?: string | null
          payload?: Json
          payment_id?: string | null
          processed_at?: string | null
          recipient?: string | null
          revenue_attributed?: number
          scheduled_for?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_automation_rule_id_fkey"
            columns: ["automation_rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience: string | null
          created_at: string
          id: string
          is_demo: boolean
          message: string | null
          sent_count: number | null
          status: string | null
          title: string
          type: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          audience?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          message?: string | null
          sent_count?: number | null
          status?: string | null
          title: string
          type?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          audience?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          message?: string | null
          sent_count?: number | null
          status?: string | null
          title?: string
          type?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      checkout_items: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          is_demo: boolean
          item_id: string | null
          item_type: string | null
          price: number | null
          quantity: number | null
          title: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          is_demo?: boolean
          item_id?: string | null
          item_type?: string | null
          price?: number | null
          quantity?: number | null
          title: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          is_demo?: boolean
          item_id?: string | null
          item_type?: string | null
          price?: number | null
          quantity?: number | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_items_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_memberships: {
        Row: {
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          credits_available: number
          credits_used: number
          current_period_end: string | null
          current_period_start: string
          customer_id: string | null
          failure_reason: string | null
          id: string
          is_demo: boolean
          last_payment_status: string
          membership_plan_id: string
          metadata: Json
          mollie_customer_id: string | null
          mollie_subscription_id: string | null
          next_payment_at: string | null
          paused_at: string | null
          start_date: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          credits_available?: number
          credits_used?: number
          current_period_end?: string | null
          current_period_start?: string
          customer_id?: string | null
          failure_reason?: string | null
          id?: string
          is_demo?: boolean
          last_payment_status?: string
          membership_plan_id: string
          metadata?: Json
          mollie_customer_id?: string | null
          mollie_subscription_id?: string | null
          next_payment_at?: string | null
          paused_at?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          credits_available?: number
          credits_used?: number
          current_period_end?: string | null
          current_period_start?: string
          customer_id?: string | null
          failure_reason?: string | null
          id?: string
          is_demo?: boolean
          last_payment_status?: string
          membership_plan_id?: string
          metadata?: Json
          mollie_customer_id?: string | null
          mollie_subscription_id?: string | null
          next_payment_at?: string | null
          paused_at?: string | null
          start_date?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_memberships_membership_plan_id_fkey"
            columns: ["membership_plan_id"]
            isOneToOne: false
            referencedRelation: "membership_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_message_preferences: {
        Row: {
          created_at: string
          customer_id: string
          email_opt_out: boolean
          id: string
          is_demo: boolean
          language: string
          preferred_channel: string
          sms_opt_out: boolean
          updated_at: string
          user_id: string
          whatsapp_opt_out: boolean
        }
        Insert: {
          created_at?: string
          customer_id: string
          email_opt_out?: boolean
          id?: string
          is_demo?: boolean
          language?: string
          preferred_channel?: string
          sms_opt_out?: boolean
          updated_at?: string
          user_id: string
          whatsapp_opt_out?: boolean
        }
        Update: {
          created_at?: string
          customer_id?: string
          email_opt_out?: boolean
          id?: string
          is_demo?: boolean
          language?: string
          preferred_channel?: string
          sms_opt_out?: boolean
          updated_at?: string
          user_id?: string
          whatsapp_opt_out?: boolean
        }
        Relationships: []
      }
      customer_tags: {
        Row: {
          created_at: string
          customer_id: string
          id: string
          is_demo: boolean
          tag: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id: string
          id?: string
          is_demo?: boolean
          tag: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string
          id?: string
          is_demo?: boolean
          tag?: string
          user_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          cancellation_count: number | null
          created_at: string
          email: string | null
          id: string
          is_demo: boolean
          is_vip: boolean | null
          loyalty_points: number | null
          marketing_consent: boolean | null
          name: string
          no_show_count: number | null
          notes: string | null
          phone: string | null
          privacy_consent: boolean | null
          total_spent: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancellation_count?: number | null
          created_at?: string
          email?: string | null
          id?: string
          is_demo?: boolean
          is_vip?: boolean | null
          loyalty_points?: number | null
          marketing_consent?: boolean | null
          name: string
          no_show_count?: number | null
          notes?: string | null
          phone?: string | null
          privacy_consent?: boolean | null
          total_spent?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancellation_count?: number | null
          created_at?: string
          email?: string | null
          id?: string
          is_demo?: boolean
          is_vip?: boolean | null
          loyalty_points?: number | null
          marketing_consent?: boolean | null
          name?: string
          no_show_count?: number | null
          notes?: string | null
          phone?: string | null
          privacy_consent?: boolean | null
          total_spent?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      demo_requests: {
        Row: {
          created_at: string
          email: string
          follow_up_notes: string | null
          followed_up_at: string | null
          id: string
          message: string | null
          name: string
          phone: string | null
          salon_name: string | null
          salon_type: string | null
          source: string
          status: string
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          created_at?: string
          email: string
          follow_up_notes?: string | null
          followed_up_at?: string | null
          id?: string
          message?: string | null
          name: string
          phone?: string | null
          salon_name?: string | null
          salon_type?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          follow_up_notes?: string | null
          followed_up_at?: string | null
          id?: string
          message?: string | null
          name?: string
          phone?: string | null
          salon_name?: string | null
          salon_type?: string | null
          source?: string
          status?: string
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      discounts: {
        Row: {
          created_at: string
          id: string
          is_active: boolean | null
          is_demo: boolean
          title: string
          type: string | null
          updated_at: string
          user_id: string
          value: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          title: string
          type?: string | null
          updated_at?: string
          user_id: string
          value?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          title?: string
          type?: string | null
          updated_at?: string
          user_id?: string
          value?: number | null
        }
        Relationships: []
      }
      feedback_entries: {
        Row: {
          comment: string | null
          created_at: string
          customer_id: string | null
          id: string
          is_demo: boolean
          rating: number
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          is_demo?: boolean
          rating?: number
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          is_demo?: boolean
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_cards: {
        Row: {
          code: string
          created_at: string
          customer_id: string | null
          customer_name: string | null
          expires_at: string | null
          id: string
          initial_amount: number
          is_demo: boolean
          remaining_amount: number
          sold_via: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          expires_at?: string | null
          id?: string
          initial_amount?: number
          is_demo?: boolean
          remaining_amount?: number
          sold_via?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          customer_id?: string | null
          customer_name?: string | null
          expires_at?: string | null
          id?: string
          initial_amount?: number
          is_demo?: boolean
          remaining_amount?: number
          sold_via?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_cards_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          created_at: string
          email: string | null
          followed_up_at: string | null
          id: string
          is_demo: boolean
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          followed_up_at?: string | null
          id?: string
          is_demo?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          followed_up_at?: string | null
          id?: string
          is_demo?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      membership_plans: {
        Row: {
          benefits: Json
          billing_interval: string
          created_at: string
          credits_reset: boolean
          description: string
          discount_percentage: number
          id: string
          included_treatments: number
          is_active: boolean
          is_demo: boolean
          name: string
          price: number
          priority_booking: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          benefits?: Json
          billing_interval?: string
          created_at?: string
          credits_reset?: boolean
          description?: string
          discount_percentage?: number
          id?: string
          included_treatments?: number
          is_active?: boolean
          is_demo?: boolean
          name: string
          price?: number
          priority_booking?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          benefits?: Json
          billing_interval?: string
          created_at?: string
          credits_reset?: boolean
          description?: string
          discount_percentage?: number
          id?: string
          included_treatments?: number
          is_active?: boolean
          is_demo?: boolean
          name?: string
          price?: number
          priority_booking?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      membership_usage: {
        Row: {
          appointment_id: string | null
          benefit_type: string
          created_at: string
          credits_used: number
          customer_id: string | null
          customer_membership_id: string
          discount_amount: number
          id: string
          is_demo: boolean
          notes: string
          service_id: string | null
          used_at: string
          user_id: string
        }
        Insert: {
          appointment_id?: string | null
          benefit_type?: string
          created_at?: string
          credits_used?: number
          customer_id?: string | null
          customer_membership_id: string
          discount_amount?: number
          id?: string
          is_demo?: boolean
          notes?: string
          service_id?: string | null
          used_at?: string
          user_id: string
        }
        Update: {
          appointment_id?: string | null
          benefit_type?: string
          created_at?: string
          credits_used?: number
          customer_id?: string | null
          customer_membership_id?: string
          discount_amount?: number
          id?: string
          is_demo?: boolean
          notes?: string
          service_id?: string | null
          used_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "membership_usage_customer_membership_id_fkey"
            columns: ["customer_membership_id"]
            isOneToOne: false
            referencedRelation: "customer_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      mollie_connections: {
        Row: {
          account_name: string | null
          connected_at: string
          created_at: string
          disconnected_at: string | null
          id: string
          is_active: boolean
          is_demo: boolean
          last_sync_at: string | null
          metadata: Json
          mollie_access_token: string
          mollie_access_token_expires_at: string | null
          mollie_mode: string
          mollie_organization_id: string | null
          mollie_refresh_token: string
          onboarding_status: string
          organization_name: string | null
          salon_id: string
          supported_methods: Json
          updated_at: string
          user_id: string
          webhook_status: string
        }
        Insert: {
          account_name?: string | null
          connected_at?: string
          created_at?: string
          disconnected_at?: string | null
          id?: string
          is_active?: boolean
          is_demo?: boolean
          last_sync_at?: string | null
          metadata?: Json
          mollie_access_token: string
          mollie_access_token_expires_at?: string | null
          mollie_mode?: string
          mollie_organization_id?: string | null
          mollie_refresh_token: string
          onboarding_status?: string
          organization_name?: string | null
          salon_id: string
          supported_methods?: Json
          updated_at?: string
          user_id: string
          webhook_status?: string
        }
        Update: {
          account_name?: string | null
          connected_at?: string
          created_at?: string
          disconnected_at?: string | null
          id?: string
          is_active?: boolean
          is_demo?: boolean
          last_sync_at?: string | null
          metadata?: Json
          mollie_access_token?: string
          mollie_access_token_expires_at?: string | null
          mollie_mode?: string
          mollie_organization_id?: string | null
          mollie_refresh_token?: string
          onboarding_status?: string
          organization_name?: string | null
          salon_id?: string
          supported_methods?: Json
          updated_at?: string
          user_id?: string
          webhook_status?: string
        }
        Relationships: []
      }
      mollie_oauth_states: {
        Row: {
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          is_demo: boolean
          redirect_to: string | null
          salon_id: string
          state: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          is_demo?: boolean
          redirect_to?: string | null
          salon_id: string
          state: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          is_demo?: boolean
          redirect_to?: string | null
          salon_id?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_links: {
        Row: {
          amount: number
          created_at: string
          customer_id: string | null
          description: string | null
          expires_at: string | null
          id: string
          is_demo: boolean
          link_url: string | null
          paid_at: string | null
          status: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          customer_id?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_demo?: boolean
          link_url?: string | null
          paid_at?: string | null
          status?: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          customer_id?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          is_demo?: boolean
          link_url?: string | null
          paid_at?: string | null
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_links_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_refunds: {
        Row: {
          amount: number
          created_at: string
          currency: string
          id: string
          is_demo: boolean
          metadata: Json
          mollie_refund_id: string | null
          payment_id: string
          reason: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          is_demo?: boolean
          metadata?: Json
          mollie_refund_id?: string | null
          payment_id: string
          reason?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          id?: string
          is_demo?: boolean
          metadata?: Json
          mollie_refund_id?: string | null
          payment_id?: string
          reason?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payments: {
        Row: {
          amount: number
          appointment_id: string | null
          checkout_reference: string | null
          created_at: string
          currency: string
          customer_id: string | null
          failure_reason: string | null
          id: string
          is_demo: boolean
          last_status_sync_at: string | null
          membership_id: string | null
          metadata: Json | null
          method: string | null
          mollie_method: string | null
          mollie_payment_id: string | null
          order_id: string | null
          paid_at: string | null
          payment_method: string | null
          payment_type: string
          provider: string | null
          refunded_amount: number
          status: string
          updated_at: string
          user_id: string
          webhook_received_at: string | null
        }
        Insert: {
          amount?: number
          appointment_id?: string | null
          checkout_reference?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          failure_reason?: string | null
          id?: string
          is_demo?: boolean
          last_status_sync_at?: string | null
          membership_id?: string | null
          metadata?: Json | null
          method?: string | null
          mollie_method?: string | null
          mollie_payment_id?: string | null
          order_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_type?: string
          provider?: string | null
          refunded_amount?: number
          status?: string
          updated_at?: string
          user_id: string
          webhook_received_at?: string | null
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          checkout_reference?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          failure_reason?: string | null
          id?: string
          is_demo?: boolean
          last_status_sync_at?: string | null
          membership_id?: string | null
          metadata?: Json | null
          method?: string | null
          mollie_method?: string | null
          mollie_payment_id?: string | null
          order_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_type?: string
          provider?: string | null
          refunded_amount?: number
          status?: string
          updated_at?: string
          user_id?: string
          webhook_received_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          is_demo: boolean
          name: string
          online_visible: boolean | null
          price: number
          stock: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_demo?: boolean
          name: string
          online_visible?: boolean | null
          price?: number
          stock?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          is_demo?: boolean
          name?: string
          online_visible?: boolean | null
          price?: number
          stock?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
          salon_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          salon_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          salon_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rebook_actions: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          is_demo: boolean
          status: string | null
          suggested_date: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          is_demo?: boolean
          status?: string | null
          suggested_date?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          is_demo?: boolean
          status?: string | null
          suggested_date?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rebook_actions_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      refund_approvals: {
        Row: {
          approval_level: number
          approver_user_id: string
          created_at: string
          id: string
          is_demo: boolean
          note: string | null
          refund_request_id: string
          status: string
          user_id: string
        }
        Insert: {
          approval_level?: number
          approver_user_id: string
          created_at?: string
          id?: string
          is_demo?: boolean
          note?: string | null
          refund_request_id: string
          status?: string
          user_id: string
        }
        Update: {
          approval_level?: number
          approver_user_id?: string
          created_at?: string
          id?: string
          is_demo?: boolean
          note?: string | null
          refund_request_id?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      refund_events: {
        Row: {
          actor_user_id: string | null
          amount: number | null
          created_at: string
          event_type: string
          id: string
          ip_address: string | null
          is_demo: boolean
          metadata: Json
          notes: string | null
          payment_id: string | null
          reason: string | null
          refund_request_id: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          actor_user_id?: string | null
          amount?: number | null
          created_at?: string
          event_type: string
          id?: string
          ip_address?: string | null
          is_demo?: boolean
          metadata?: Json
          notes?: string | null
          payment_id?: string | null
          reason?: string | null
          refund_request_id?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          actor_user_id?: string | null
          amount?: number | null
          created_at?: string
          event_type?: string
          id?: string
          ip_address?: string | null
          is_demo?: boolean
          metadata?: Json
          notes?: string | null
          payment_id?: string | null
          reason?: string | null
          refund_request_id?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      refund_requests: {
        Row: {
          amount: number
          appointment_id: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          currency: string
          custom_reason: string | null
          customer_id: string | null
          executed_at: string | null
          executed_by: string | null
          failure_reason: string | null
          id: string
          idempotency_key: string
          internal_note: string | null
          is_demo: boolean
          metadata: Json
          mollie_refund_id: string | null
          notify_customer: boolean
          payment_id: string
          processed_at: string | null
          reason: string
          requested_at: string
          requested_by: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          appointment_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          custom_reason?: string | null
          customer_id?: string | null
          executed_at?: string | null
          executed_by?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          internal_note?: string | null
          is_demo?: boolean
          metadata?: Json
          mollie_refund_id?: string | null
          notify_customer?: boolean
          payment_id: string
          processed_at?: string | null
          reason: string
          requested_at?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          currency?: string
          custom_reason?: string | null
          customer_id?: string | null
          executed_at?: string | null
          executed_by?: string | null
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          internal_note?: string | null
          is_demo?: boolean
          metadata?: Json
          mollie_refund_id?: string | null
          notify_customer?: boolean
          payment_id?: string
          processed_at?: string | null
          reason?: string
          requested_at?: string
          requested_by?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      services: {
        Row: {
          category: string | null
          color: string | null
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean | null
          is_demo: boolean
          is_internal_only: boolean | null
          is_online_bookable: boolean | null
          name: string
          price: number
          updated_at: string
          user_id: string
        }
        Insert: {
          category?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          is_internal_only?: boolean | null
          is_online_bookable?: boolean | null
          name: string
          price?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: string | null
          color?: string | null
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          is_internal_only?: boolean | null
          is_online_bookable?: boolean | null
          name?: string
          price?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          appointment_reminder_schedule: Json
          auto_block_noshow: number | null
          buffer_minutes: number | null
          cancellation_notice: string | null
          created_at: string
          currency: string | null
          demo_mode: boolean | null
          deposit_new_client: boolean | null
          deposit_noshow_risk: boolean | null
          deposit_percentage: number | null
          email_enabled: boolean | null
          full_prepay_threshold: number | null
          google_calendar_enabled: boolean | null
          group_bookings_enabled: boolean | null
          id: string
          instagram_booking_enabled: boolean | null
          is_demo: boolean
          language: string | null
          max_bookings_simultaneous: number | null
          mollie_mode: string | null
          opening_hours: Json | null
          public_employees_enabled: boolean | null
          public_slug: string | null
          salon_name: string | null
          show_prices_online: boolean | null
          skip_prepay_vip: boolean | null
          timezone: string | null
          updated_at: string
          user_id: string
          webshop_enabled: boolean | null
          whatsapp_enabled: boolean | null
          whitelabel_branding: Json | null
        }
        Insert: {
          appointment_reminder_schedule?: Json
          auto_block_noshow?: number | null
          buffer_minutes?: number | null
          cancellation_notice?: string | null
          created_at?: string
          currency?: string | null
          demo_mode?: boolean | null
          deposit_new_client?: boolean | null
          deposit_noshow_risk?: boolean | null
          deposit_percentage?: number | null
          email_enabled?: boolean | null
          full_prepay_threshold?: number | null
          google_calendar_enabled?: boolean | null
          group_bookings_enabled?: boolean | null
          id?: string
          instagram_booking_enabled?: boolean | null
          is_demo?: boolean
          language?: string | null
          max_bookings_simultaneous?: number | null
          mollie_mode?: string | null
          opening_hours?: Json | null
          public_employees_enabled?: boolean | null
          public_slug?: string | null
          salon_name?: string | null
          show_prices_online?: boolean | null
          skip_prepay_vip?: boolean | null
          timezone?: string | null
          updated_at?: string
          user_id: string
          webshop_enabled?: boolean | null
          whatsapp_enabled?: boolean | null
          whitelabel_branding?: Json | null
        }
        Update: {
          appointment_reminder_schedule?: Json
          auto_block_noshow?: number | null
          buffer_minutes?: number | null
          cancellation_notice?: string | null
          created_at?: string
          currency?: string | null
          demo_mode?: boolean | null
          deposit_new_client?: boolean | null
          deposit_noshow_risk?: boolean | null
          deposit_percentage?: number | null
          email_enabled?: boolean | null
          full_prepay_threshold?: number | null
          google_calendar_enabled?: boolean | null
          group_bookings_enabled?: boolean | null
          id?: string
          instagram_booking_enabled?: boolean | null
          is_demo?: boolean
          language?: string | null
          max_bookings_simultaneous?: number | null
          mollie_mode?: string | null
          opening_hours?: Json | null
          public_employees_enabled?: boolean | null
          public_slug?: string | null
          salon_name?: string | null
          show_prices_online?: boolean | null
          skip_prepay_vip?: boolean | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
          webshop_enabled?: boolean | null
          whatsapp_enabled?: boolean | null
          whitelabel_branding?: Json | null
        }
        Relationships: []
      }
      sub_appointments: {
        Row: {
          assigned_employee_id: string | null
          assignment_mode: string | null
          created_at: string
          id: string
          is_demo: boolean
          notes: string | null
          parent_appointment_id: string
          person_name: string
          price: number | null
          service_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assigned_employee_id?: string | null
          assignment_mode?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          parent_appointment_id: string
          person_name: string
          price?: number | null
          service_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assigned_employee_id?: string | null
          assignment_mode?: string | null
          created_at?: string
          id?: string
          is_demo?: boolean
          notes?: string | null
          parent_appointment_id?: string
          person_name?: string
          price?: number | null
          service_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sub_appointments_parent_appointment_id_fkey"
            columns: ["parent_appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sub_appointments_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          features: Json
          id: string
          interval: string
          is_active: boolean
          is_highlighted: boolean
          name: string
          price_cents: number
          price_eur: number
          requires_demo: boolean
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          is_highlighted?: boolean
          name: string
          price_cents: number
          price_eur: number
          requires_demo?: boolean
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          is_highlighted?: boolean
          name?: string
          price_cents?: number
          price_eur?: number
          requires_demo?: boolean
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          day10_sent_at: string | null
          day14_sent_at: string | null
          day3_sent_at: string | null
          day7_sent_at: string | null
          id: string
          last_payment_id: string | null
          mollie_customer_id: string | null
          mollie_mandate_id: string | null
          mollie_subscription_id: string | null
          past_due_since: string | null
          payment_failure_email_sent_at: string | null
          plan_slug: string
          retry_attempted_at: string | null
          status: string
          trial_ends_at: string
          trial_started_at: string
          updated_at: string
          user_id: string
          welcome_sent_at: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          day10_sent_at?: string | null
          day14_sent_at?: string | null
          day3_sent_at?: string | null
          day7_sent_at?: string | null
          id?: string
          last_payment_id?: string | null
          mollie_customer_id?: string | null
          mollie_mandate_id?: string | null
          mollie_subscription_id?: string | null
          past_due_since?: string | null
          payment_failure_email_sent_at?: string | null
          plan_slug: string
          retry_attempted_at?: string | null
          status?: string
          trial_ends_at?: string
          trial_started_at?: string
          updated_at?: string
          user_id: string
          welcome_sent_at?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          day10_sent_at?: string | null
          day14_sent_at?: string | null
          day3_sent_at?: string | null
          day7_sent_at?: string | null
          id?: string
          last_payment_id?: string | null
          mollie_customer_id?: string | null
          mollie_mandate_id?: string | null
          mollie_subscription_id?: string | null
          past_due_since?: string | null
          payment_failure_email_sent_at?: string | null
          plan_slug?: string
          retry_attempted_at?: string | null
          status?: string
          trial_ends_at?: string
          trial_started_at?: string
          updated_at?: string
          user_id?: string
          welcome_sent_at?: string | null
        }
        Relationships: []
      }
      user_access: {
        Row: {
          created_at: string
          email: string
          id: string
          is_demo: boolean
          last_active_at: string | null
          member_user_id: string | null
          name: string
          owner_user_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          is_demo?: boolean
          last_active_at?: string | null
          member_user_id?: string | null
          name?: string
          owner_user_id: string
          role: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          is_demo?: boolean
          last_active_at?: string | null
          member_user_id?: string | null
          name?: string
          owner_user_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      waitlist_entries: {
        Row: {
          created_at: string
          customer_id: string | null
          flexibility: string | null
          id: string
          is_demo: boolean
          notes: string | null
          preferred_day: string | null
          preferred_employee: string | null
          preferred_time: string | null
          service_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          flexibility?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          preferred_day?: string | null
          preferred_employee?: string | null
          preferred_time?: string | null
          service_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          flexibility?: string | null
          id?: string
          is_demo?: boolean
          notes?: string | null
          preferred_day?: string | null
          preferred_employee?: string | null
          preferred_time?: string | null
          service_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
      }
      webshop_orders: {
        Row: {
          created_at: string
          currency: string
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          id: string
          is_demo: boolean
          items: Json
          mollie_payment_id: string | null
          order_number: string
          payment_id: string | null
          payment_status: string
          status: string
          stock_processed_at: string | null
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          is_demo?: boolean
          items?: Json
          mollie_payment_id?: string | null
          order_number: string
          payment_id?: string | null
          payment_status?: string
          status?: string
          stock_processed_at?: string | null
          total_amount?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          customer_email?: string | null
          customer_id?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          id?: string
          is_demo?: boolean
          items?: Json
          mollie_payment_id?: string | null
          order_number?: string
          payment_id?: string | null
          payment_status?: string
          status?: string
          stock_processed_at?: string | null
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      white_label_email_logs: {
        Row: {
          created_at: string
          error_message: string | null
          from_email: string
          from_name: string
          id: string
          is_demo: boolean
          metadata: Json
          provider: string
          provider_message_id: string | null
          recipient_email: string
          salon_slug: string
          status: string
          subject: string
          template_key: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          from_email: string
          from_name: string
          id?: string
          is_demo?: boolean
          metadata?: Json
          provider?: string
          provider_message_id?: string | null
          recipient_email: string
          salon_slug: string
          status?: string
          subject: string
          template_key: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          from_email?: string
          from_name?: string
          id?: string
          is_demo?: boolean
          metadata?: Json
          provider?: string
          provider_message_id?: string | null
          recipient_email?: string
          salon_slug?: string
          status?: string
          subject?: string
          template_key?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      bootstrap_current_user: { Args: never; Returns: Json }
      can_manage_operations: { Args: { _user_id: string }; Returns: boolean }
      can_manage_users: { Args: { _user_id: string }; Returns: boolean }
      can_view_finance: { Args: { _user_id: string }; Returns: boolean }
      current_account_is_demo: { Args: never; Returns: boolean }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      prevent_live_demo_reset: { Args: { _user_id: string }; Returns: boolean }
      process_paid_webshop_order_stock: {
        Args: { _order_id: string }
        Returns: boolean
      }
      reset_due_membership_credits: {
        Args: { _user_id: string }
        Returns: number
      }
      user_row_matches_active_mode: {
        Args: { _row_is_demo: boolean; _row_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "eigenaar"
        | "admin"
        | "medewerker"
        | "financieel"
        | "manager"
        | "receptie"
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
      app_role: [
        "eigenaar",
        "admin",
        "medewerker",
        "financieel",
        "manager",
        "receptie",
      ],
    },
  },
} as const
