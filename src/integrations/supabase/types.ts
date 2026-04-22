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
      automation_rules: {
        Row: {
          action_type: string
          config: Json | null
          created_at: string
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          trigger_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action_type: string
          config?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          trigger_type: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action_type?: string
          config?: Json | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          trigger_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      campaigns: {
        Row: {
          audience: string | null
          created_at: string
          id: string
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
      customers: {
        Row: {
          cancellation_count: number | null
          created_at: string
          email: string | null
          id: string
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
      discounts: {
        Row: {
          created_at: string
          id: string
          is_active: boolean | null
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
          rating: number
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
          rating?: number
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          customer_id?: string | null
          id?: string
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
      payment_links: {
        Row: {
          amount: number
          created_at: string
          customer_id: string | null
          description: string | null
          expires_at: string | null
          id: string
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
      payments: {
        Row: {
          amount: number
          appointment_id: string | null
          checkout_reference: string | null
          created_at: string
          currency: string
          customer_id: string | null
          id: string
          is_demo: boolean
          method: string | null
          mollie_payment_id: string | null
          paid_at: string | null
          payment_method: string | null
          payment_type: string
          provider: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          appointment_id?: string | null
          checkout_reference?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          id?: string
          is_demo?: boolean
          method?: string | null
          mollie_payment_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_type?: string
          provider?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          appointment_id?: string | null
          checkout_reference?: string | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          id?: string
          is_demo?: boolean
          method?: string | null
          mollie_payment_id?: string | null
          paid_at?: string | null
          payment_method?: string | null
          payment_type?: string
          provider?: string | null
          status?: string
          updated_at?: string
          user_id?: string
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
          is_active: boolean | null
          name: string
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
          is_active?: boolean | null
          name: string
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
          is_active?: boolean | null
          name?: string
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
          status: string | null
          suggested_date: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          status?: string | null
          suggested_date?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
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
      services: {
        Row: {
          category: string | null
          color: string | null
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean | null
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
          whatsapp_enabled: boolean | null
          whitelabel_branding: Json | null
        }
        Insert: {
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
          whatsapp_enabled?: boolean | null
          whitelabel_branding?: Json | null
        }
        Update: {
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "eigenaar" | "admin" | "medewerker" | "financieel"
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
      app_role: ["eigenaar", "admin", "medewerker", "financieel"],
    },
  },
} as const
