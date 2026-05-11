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
      analytics_events: {
        Row: {
          created_at: string
          event_name: string
          id: string
          properties: Json
          referrer: string | null
          session_id: string | null
          url: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          event_name: string
          id?: string
          properties?: Json
          referrer?: string | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          event_name?: string
          id?: string
          properties?: Json
          referrer?: string | null
          session_id?: string | null
          url?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      appointment_employees: {
        Row: {
          appointment_id: string
          created_at: string
          employee_id: string
          id: string
          is_demo: boolean
          is_primary: boolean
          user_id: string
        }
        Insert: {
          appointment_id: string
          created_at?: string
          employee_id: string
          id?: string
          is_demo?: boolean
          is_primary?: boolean
          user_id: string
        }
        Update: {
          appointment_id?: string
          created_at?: string
          employee_id?: string
          id?: string
          is_demo?: boolean
          is_primary?: boolean
          user_id?: string
        }
        Relationships: []
      }
      appointments: {
        Row: {
          accepted_glowsuite_terms: boolean
          accepted_salon_terms: boolean
          accepted_terms_at: string | null
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
          payment_expires_at: string | null
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
          accepted_glowsuite_terms?: boolean
          accepted_salon_terms?: boolean
          accepted_terms_at?: string | null
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
          payment_expires_at?: string | null
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
          accepted_glowsuite_terms?: boolean
          accepted_salon_terms?: boolean
          accepted_terms_at?: string | null
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
          payment_expires_at?: string | null
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
      auto_revenue_offers: {
        Row: {
          appointment_date: string
          appointment_id: string | null
          created_at: string
          customer_id: string
          employee_id: string | null
          end_time: string
          expires_at: string
          id: string
          is_demo: boolean
          service_id: string | null
          start_time: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          appointment_date: string
          appointment_id?: string | null
          created_at?: string
          customer_id: string
          employee_id?: string | null
          end_time: string
          expires_at: string
          id?: string
          is_demo?: boolean
          service_id?: string | null
          start_time: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          appointment_date?: string
          appointment_id?: string | null
          created_at?: string
          customer_id?: string
          employee_id?: string | null
          end_time?: string
          expires_at?: string
          id?: string
          is_demo?: boolean
          service_id?: string | null
          start_time?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_revenue_offers_appointment_id_fkey"
            columns: ["appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_revenue_offers_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_revenue_offers_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
        ]
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
      autopilot_action_logs: {
        Row: {
          action: string
          actual_revenue_cents: number
          appointment_id: string | null
          created_at: string
          customer_id: string | null
          decision_id: string | null
          expected_revenue_cents: number
          id: string
          is_demo: boolean
          message: string
          metadata: Json
          run_id: string
          status: string
          user_id: string
        }
        Insert: {
          action: string
          actual_revenue_cents?: number
          appointment_id?: string | null
          created_at?: string
          customer_id?: string | null
          decision_id?: string | null
          expected_revenue_cents?: number
          id?: string
          is_demo?: boolean
          message?: string
          metadata?: Json
          run_id: string
          status?: string
          user_id: string
        }
        Update: {
          action?: string
          actual_revenue_cents?: number
          appointment_id?: string | null
          created_at?: string
          customer_id?: string | null
          decision_id?: string | null
          expected_revenue_cents?: number
          id?: string
          is_demo?: boolean
          message?: string
          metadata?: Json
          run_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_action_logs_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "autopilot_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "autopilot_action_logs_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "autopilot_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      autopilot_decisions: {
        Row: {
          action: string
          created_at: string
          employee_id: string | null
          expected_revenue_cents: number
          fill_probability: number
          id: string
          is_demo: boolean
          reason: string
          run_id: string
          score: number
          slot_date: string
          slot_time: string | null
          status: string
          urgency_multiplier: number
          user_id: string
        }
        Insert: {
          action?: string
          created_at?: string
          employee_id?: string | null
          expected_revenue_cents?: number
          fill_probability?: number
          id?: string
          is_demo?: boolean
          reason?: string
          run_id: string
          score?: number
          slot_date: string
          slot_time?: string | null
          status?: string
          urgency_multiplier?: number
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          employee_id?: string | null
          expected_revenue_cents?: number
          fill_probability?: number
          id?: string
          is_demo?: boolean
          reason?: string
          run_id?: string
          score?: number
          slot_date?: string
          slot_time?: string | null
          status?: string
          urgency_multiplier?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "autopilot_decisions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "autopilot_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      autopilot_runs: {
        Row: {
          actions_count: number
          actual_revenue_cents: number
          created_at: string
          expected_revenue_cents: number
          finished_at: string | null
          id: string
          is_demo: boolean
          run_type: string
          started_at: string
          status: string
          user_id: string
        }
        Insert: {
          actions_count?: number
          actual_revenue_cents?: number
          created_at?: string
          expected_revenue_cents?: number
          finished_at?: string | null
          id?: string
          is_demo?: boolean
          run_type?: string
          started_at?: string
          status?: string
          user_id: string
        }
        Update: {
          actions_count?: number
          actual_revenue_cents?: number
          created_at?: string
          expected_revenue_cents?: number
          finished_at?: string | null
          id?: string
          is_demo?: boolean
          run_type?: string
          started_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
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
          whatsapp_opt_in: boolean | null
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
          whatsapp_opt_in?: boolean | null
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
          whatsapp_opt_in?: boolean | null
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
      employee_availability_exceptions: {
        Row: {
          created_at: string
          days_of_week: number[] | null
          employee_id: string
          end_date: string | null
          end_time: string | null
          id: string
          is_demo: boolean
          label: string | null
          note: string | null
          start_date: string
          start_time: string | null
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          days_of_week?: number[] | null
          employee_id: string
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_demo?: boolean
          label?: string | null
          note?: string | null
          start_date: string
          start_time?: string | null
          type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          days_of_week?: number[] | null
          employee_id?: string
          end_date?: string | null
          end_time?: string | null
          id?: string
          is_demo?: boolean
          label?: string | null
          note?: string | null
          start_date?: string
          start_time?: string | null
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_availability_exceptions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_payroll_adjustments: {
        Row: {
          amount_cents: number
          created_at: string
          employee_id: string
          id: string
          is_demo: boolean
          note: string
          period_month: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_cents?: number
          created_at?: string
          employee_id: string
          id?: string
          is_demo?: boolean
          note?: string
          period_month: string
          type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          employee_id?: string
          id?: string
          is_demo?: boolean
          note?: string
          period_month?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employee_payroll_settings: {
        Row: {
          commission_percentage_bps: number
          created_at: string
          employee_id: string
          fixed_commission_cents: number
          hourly_rate_cents: number
          id: string
          is_demo: boolean
          tips_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          commission_percentage_bps?: number
          created_at?: string
          employee_id: string
          fixed_commission_cents?: number
          hourly_rate_cents?: number
          id?: string
          is_demo?: boolean
          tips_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          commission_percentage_bps?: number
          created_at?: string
          employee_id?: string
          fixed_commission_cents?: number
          hourly_rate_cents?: number
          id?: string
          is_demo?: boolean
          tips_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employee_time_entries: {
        Row: {
          break_minutes: number
          clock_in: string | null
          clock_out: string | null
          created_at: string
          date: string
          employee_id: string
          id: string
          is_demo: boolean
          notes: string
          updated_at: string
          user_id: string
        }
        Insert: {
          break_minutes?: number
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date: string
          employee_id: string
          id?: string
          is_demo?: boolean
          notes?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          break_minutes?: number
          clock_in?: string | null
          clock_out?: string | null
          created_at?: string
          date?: string
          employee_id?: string
          id?: string
          is_demo?: boolean
          notes?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      employees: {
        Row: {
          break_end: string | null
          break_start: string | null
          breaks: Json
          color: string
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          is_demo: boolean
          name: string
          phone: string | null
          photo_url: string | null
          role: string
          services: Json
          sort_order: number
          status: string
          status_from: string | null
          status_note: string | null
          status_until: string | null
          updated_at: string
          user_id: string
          working_days: number[]
        }
        Insert: {
          break_end?: string | null
          break_start?: string | null
          breaks?: Json
          color?: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_demo?: boolean
          name: string
          phone?: string | null
          photo_url?: string | null
          role?: string
          services?: Json
          sort_order?: number
          status?: string
          status_from?: string | null
          status_note?: string | null
          status_until?: string | null
          updated_at?: string
          user_id: string
          working_days?: number[]
        }
        Update: {
          break_end?: string | null
          break_start?: string | null
          breaks?: Json
          color?: string
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          is_demo?: boolean
          name?: string
          phone?: string | null
          photo_url?: string | null
          role?: string
          services?: Json
          sort_order?: number
          status?: string
          status_from?: string | null
          status_note?: string | null
          status_until?: string | null
          updated_at?: string
          user_id?: string
          working_days?: number[]
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
      import_batch_items: {
        Row: {
          batch_id: string
          created_at: string
          id: string
          row_id: string
          table_name: string
          user_id: string
        }
        Insert: {
          batch_id: string
          created_at?: string
          id?: string
          row_id: string
          table_name: string
          user_id: string
        }
        Update: {
          batch_id?: string
          created_at?: string
          id?: string
          row_id?: string
          table_name?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_batch_items_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          created_at: string
          failed_count: number
          file_name: string | null
          id: string
          import_type: string
          imported_count: number
          is_demo: boolean
          skipped_count: number
          source: string
          status: string
          undone_at: string | null
          updated_at: string
          updated_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          failed_count?: number
          file_name?: string | null
          id?: string
          import_type: string
          imported_count?: number
          is_demo?: boolean
          skipped_count?: number
          source: string
          status?: string
          undone_at?: string | null
          updated_at?: string
          updated_count?: number
          user_id: string
        }
        Update: {
          created_at?: string
          failed_count?: number
          file_name?: string | null
          id?: string
          import_type?: string
          imported_count?: number
          is_demo?: boolean
          skipped_count?: number
          source?: string
          status?: string
          undone_at?: string | null
          updated_at?: string
          updated_count?: number
          user_id?: string
        }
        Relationships: []
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
          city: string | null
          created_at: string
          email: string | null
          google_review_url: string | null
          id: string
          salon_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          email?: string | null
          google_review_url?: string | null
          id?: string
          salon_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          city?: string | null
          created_at?: string
          email?: string | null
          google_review_url?: string | null
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
      referral_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          total_converted: number
          total_credit_months: number
          total_referred: number
          updated_at: string
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          total_converted?: number
          total_credit_months?: number
          total_referred?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          total_converted?: number
          total_credit_months?: number
          total_referred?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          code: string
          converted_at: string | null
          credit_months: number
          credited_at: string | null
          id: string
          referred_user_id: string
          referrer_user_id: string
          signed_up_at: string
          status: string
        }
        Insert: {
          code: string
          converted_at?: string | null
          credit_months?: number
          credited_at?: string | null
          id?: string
          referred_user_id: string
          referrer_user_id: string
          signed_up_at?: string
          status?: string
        }
        Update: {
          code?: string
          converted_at?: string | null
          credit_months?: number
          credited_at?: string | null
          id?: string
          referred_user_id?: string
          referrer_user_id?: string
          signed_up_at?: string
          status?: string
        }
        Relationships: []
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
      review_prompts: {
        Row: {
          created_at: string
          dismissed_at: string | null
          id: string
          rating: number | null
          responded_at: string | null
          shown_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          dismissed_at?: string | null
          id?: string
          rating?: number | null
          responded_at?: string | null
          shown_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          dismissed_at?: string | null
          id?: string
          rating?: number | null
          responded_at?: string | null
          shown_at?: string | null
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
          auto_revenue_deposit_enabled: boolean
          auto_revenue_deposit_fixed_cents: number
          auto_revenue_deposit_max_cents: number
          auto_revenue_deposit_min_cents: number
          auto_revenue_deposit_percentage_bps: number
          auto_revenue_deposit_type: string
          auto_revenue_payment_mode: string
          auto_revenue_reservation_hold_minutes: number
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
          payment_provider: string
          payment_provider_fallback_enabled: boolean
          public_employees_enabled: boolean | null
          public_slug: string | null
          salon_name: string | null
          show_prices_online: boolean | null
          skip_prepay_vip: boolean | null
          timezone: string | null
          updated_at: string
          user_id: string
          viva_client_id: string | null
          viva_demo_enabled: boolean
          viva_live_enabled: boolean
          viva_merchant_id: string | null
          viva_source_code: string | null
          viva_status: string
          webshop_enabled: boolean | null
          whatsapp_enabled: boolean | null
          whitelabel_branding: Json | null
        }
        Insert: {
          appointment_reminder_schedule?: Json
          auto_block_noshow?: number | null
          auto_revenue_deposit_enabled?: boolean
          auto_revenue_deposit_fixed_cents?: number
          auto_revenue_deposit_max_cents?: number
          auto_revenue_deposit_min_cents?: number
          auto_revenue_deposit_percentage_bps?: number
          auto_revenue_deposit_type?: string
          auto_revenue_payment_mode?: string
          auto_revenue_reservation_hold_minutes?: number
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
          payment_provider?: string
          payment_provider_fallback_enabled?: boolean
          public_employees_enabled?: boolean | null
          public_slug?: string | null
          salon_name?: string | null
          show_prices_online?: boolean | null
          skip_prepay_vip?: boolean | null
          timezone?: string | null
          updated_at?: string
          user_id: string
          viva_client_id?: string | null
          viva_demo_enabled?: boolean
          viva_live_enabled?: boolean
          viva_merchant_id?: string | null
          viva_source_code?: string | null
          viva_status?: string
          webshop_enabled?: boolean | null
          whatsapp_enabled?: boolean | null
          whitelabel_branding?: Json | null
        }
        Update: {
          appointment_reminder_schedule?: Json
          auto_block_noshow?: number | null
          auto_revenue_deposit_enabled?: boolean
          auto_revenue_deposit_fixed_cents?: number
          auto_revenue_deposit_max_cents?: number
          auto_revenue_deposit_min_cents?: number
          auto_revenue_deposit_percentage_bps?: number
          auto_revenue_deposit_type?: string
          auto_revenue_payment_mode?: string
          auto_revenue_reservation_hold_minutes?: number
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
          payment_provider?: string
          payment_provider_fallback_enabled?: boolean
          public_employees_enabled?: boolean | null
          public_slug?: string | null
          salon_name?: string | null
          show_prices_online?: boolean | null
          skip_prepay_vip?: boolean | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
          viva_client_id?: string | null
          viva_demo_enabled?: boolean
          viva_live_enabled?: boolean
          viva_merchant_id?: string | null
          viva_source_code?: string | null
          viva_status?: string
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
          credit_months_balance: number
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
          credit_months_balance?: number
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
          credit_months_balance?: number
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
      testimonials: {
        Row: {
          city: string | null
          created_at: string
          featured: boolean
          id: string
          quote: string
          rating: number
          salon_name: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          city?: string | null
          created_at?: string
          featured?: boolean
          id?: string
          quote: string
          rating?: number
          salon_name: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          city?: string | null
          created_at?: string
          featured?: boolean
          id?: string
          quote?: string
          rating?: number
          salon_name?: string
          status?: string
          updated_at?: string
          user_id?: string | null
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
      viva_webhook_debug_logs: {
        Row: {
          body_preview: string | null
          created_at: string
          headers: Json | null
          id: string
          method: string | null
          query: Json | null
          source_ip: string | null
          user_agent: string | null
        }
        Insert: {
          body_preview?: string | null
          created_at?: string
          headers?: Json | null
          id?: string
          method?: string | null
          query?: Json | null
          source_ip?: string | null
          user_agent?: string | null
        }
        Update: {
          body_preview?: string | null
          created_at?: string
          headers?: Json | null
          id?: string
          method?: string | null
          query?: Json | null
          source_ip?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      viva_webhook_events: {
        Row: {
          created_at: string
          error: string | null
          event_id: string | null
          event_type: string | null
          event_type_id: number | null
          id: string
          is_demo: boolean
          order_code: string | null
          payment_id: string | null
          processed: boolean
          processed_at: string | null
          raw_payload: Json
          retry_count: number
          status: string | null
          transaction_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error?: string | null
          event_id?: string | null
          event_type?: string | null
          event_type_id?: number | null
          id?: string
          is_demo?: boolean
          order_code?: string | null
          payment_id?: string | null
          processed?: boolean
          processed_at?: string | null
          raw_payload?: Json
          retry_count?: number
          status?: string | null
          transaction_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error?: string | null
          event_id?: string | null
          event_type?: string | null
          event_type_id?: number | null
          id?: string
          is_demo?: boolean
          order_code?: string | null
          payment_id?: string | null
          processed?: boolean
          processed_at?: string | null
          raw_payload?: Json
          retry_count?: number
          status?: string | null
          transaction_id?: string | null
          user_id?: string | null
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
          last_offer_sent_at: string | null
          last_offered_slot: string | null
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
          last_offer_sent_at?: string | null
          last_offered_slot?: string | null
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
          last_offer_sent_at?: string | null
          last_offered_slot?: string | null
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
      whatsapp_inbound_messages: {
        Row: {
          body: string
          created_at: string
          customer_id: string | null
          from_number: string
          id: string
          is_demo: boolean
          metadata: Json
          processed: boolean
          received_at: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          customer_id?: string | null
          from_number: string
          id?: string
          is_demo?: boolean
          metadata?: Json
          processed?: boolean
          received_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          customer_id?: string | null
          from_number?: string
          id?: string
          is_demo?: boolean
          metadata?: Json
          processed?: boolean
          received_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_inbound_messages_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_logs: {
        Row: {
          appointment_id: string | null
          created_at: string
          customer_id: string | null
          error: string | null
          id: string
          kind: string
          message: string
          meta: Json
          status: string
          to_number: string
          twilio_sid: string | null
          user_id: string
        }
        Insert: {
          appointment_id?: string | null
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          kind?: string
          message: string
          meta?: Json
          status?: string
          to_number: string
          twilio_sid?: string | null
          user_id: string
        }
        Update: {
          appointment_id?: string | null
          created_at?: string
          customer_id?: string | null
          error?: string | null
          id?: string
          kind?: string
          message?: string
          meta?: Json
          status?: string
          to_number?: string
          twilio_sid?: string | null
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_scheduler_runs: {
        Row: {
          checked: number
          failed: number
          finished_at: string | null
          id: string
          meta: Json
          sent: number
          skipped: number
          started_at: string
        }
        Insert: {
          checked?: number
          failed?: number
          finished_at?: string | null
          id?: string
          meta?: Json
          sent?: number
          skipped?: number
          started_at?: string
        }
        Update: {
          checked?: number
          failed?: number
          finished_at?: string | null
          id?: string
          meta?: Json
          sent?: number
          skipped?: number
          started_at?: string
        }
        Relationships: []
      }
      whatsapp_settings: {
        Row: {
          created_at: string
          enabled: boolean
          from_number: string | null
          id: string
          monthly_included_messages: number
          overage_enabled: boolean
          reminder_hours_before: number
          revenue_boost_after_days: number
          revenue_boost_max_per_month: number
          send_booking_confirmation: boolean
          send_no_show_followup: boolean
          send_reminders: boolean
          send_revenue_boost: boolean
          send_review_request: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          from_number?: string | null
          id?: string
          monthly_included_messages?: number
          overage_enabled?: boolean
          reminder_hours_before?: number
          revenue_boost_after_days?: number
          revenue_boost_max_per_month?: number
          send_booking_confirmation?: boolean
          send_no_show_followup?: boolean
          send_reminders?: boolean
          send_revenue_boost?: boolean
          send_review_request?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          from_number?: string | null
          id?: string
          monthly_included_messages?: number
          overage_enabled?: boolean
          reminder_hours_before?: number
          revenue_boost_after_days?: number
          revenue_boost_max_per_month?: number
          send_booking_confirmation?: boolean
          send_no_show_followup?: boolean
          send_reminders?: boolean
          send_revenue_boost?: boolean
          send_review_request?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_templates: {
        Row: {
          content: string
          created_at: string
          id: string
          is_active: boolean
          template_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_active?: boolean
          template_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          template_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      whatsapp_usage_monthly: {
        Row: {
          billable_count: number
          created_at: string
          failed_count: number
          id: string
          included_limit: number
          month: string
          overage_count: number
          sent_count: number
          updated_at: string
          user_id: string
        }
        Insert: {
          billable_count?: number
          created_at?: string
          failed_count?: number
          id?: string
          included_limit?: number
          month: string
          overage_count?: number
          sent_count?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          billable_count?: number
          created_at?: string
          failed_count?: number
          id?: string
          included_limit?: number
          month?: string
          overage_count?: number
          sent_count?: number
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
      ensure_referral_code: { Args: { _user_id: string }; Returns: string }
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
      increment_whatsapp_usage: {
        Args: { _failed: number; _sent: number; _user_id: string }
        Returns: undefined
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
