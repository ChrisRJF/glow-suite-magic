import { supabase } from "@/integrations/supabase/client";

export interface PublicBookingService {
  id: string;
  name: string;
  duration: number;
  price: number;
  color?: string | null;
  description?: string | null;
}

export interface PublicBookingSalon {
  slug: string;
  name: string;
  logo_url?: string;
  primary_color?: string;
  secondary_color?: string;
  opening_hours?: unknown;
  demo_mode: boolean;
  group_bookings_enabled: boolean;
  show_prices_online: boolean;
  public_employees_enabled: boolean;
  cancellation_notice: string;
  booking_rules: {
    deposit_new_client: boolean;
    deposit_percentage: number;
    full_prepay_threshold: number;
    skip_prepay_vip: boolean;
    deposit_noshow_risk: boolean;
    mollie_mode: string;
  };
}

export interface PublicBookingData {
  salon: PublicBookingSalon;
  services: PublicBookingService[];
  employees: Array<{ id: string; name: string; role: string }>;
}

export async function callPublicBooking<T>(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke("public-booking", { body });
  if (error) throw new Error(error.message || "Boekingsserver niet bereikbaar");
  if (data?.error) {
    const err = new Error(data.error) as Error & { code?: string; payload?: unknown };
    err.code = data.code;
    err.payload = data;
    throw err;
  }
  return data as T;
}

export function nextBookingDate() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toISOString().slice(0, 10);
}
