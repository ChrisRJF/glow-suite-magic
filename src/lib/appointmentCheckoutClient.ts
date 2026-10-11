// Browser side of "Afrekenen" from an appointment. Sends ONLY action, appointment_id, method, terminal_id.
// Amounts, salon and payment status are decided by the server (Edge Function `appointment-checkout`).
import { supabase } from "@/integrations/supabase/client";

const ROLES = new Set(["eigenaar", "admin", "manager", "receptie"]);

/** Visible only when the salon flag is explicitly true and the role may check out. Any doubt = hidden. */
export function checkoutVisible(flag: { data: unknown; error: unknown }, role: string | null | undefined): boolean {
  if (flag.error || !flag.data || typeof flag.data !== "object") return false;
  return (flag.data as Record<string, unknown>).appointment_checkout_enabled === true && !!role && ROLES.has(role);
}

export async function readCheckoutVisible(role: string | null | undefined): Promise<boolean> {
  try {
    const t = await supabase.rpc("current_tenant_id");
    if (t.error || typeof t.data !== "string") return false;
    const flag = await (supabase.from("tenant_feature_flags") as any).select("appointment_checkout_enabled").eq("tenant_id", t.data).maybeSingle();
    return checkoutVisible(flag, role);
  } catch { return false; }
}

export interface CheckoutQuote { priceCents: number; paidCents: number; dueCents: number }
export type CheckoutResponse =
  | { ok: true; quote: CheckoutQuote; started?: { paymentId: string; amountCents: number; checkoutUrl: string | null } }
  | { ok: false; block: string; message: string; quote?: CheckoutQuote };

const FALLBACK = "Afrekenen is nu niet mogelijk. Er is niets gestart of afgeschreven.";

export async function callCheckout(body: { action: "quote" | "start"; appointment_id: string; method?: "terminal" | "link"; terminal_id?: string }): Promise<CheckoutResponse> {
  try {
    const { data, error } = await supabase.functions.invoke("appointment-checkout", { body });
    if (error || !data || typeof data !== "object") return { ok: false, block: "unavailable", message: FALLBACK };
    return data as CheckoutResponse;
  } catch {
    return { ok: false, block: "unavailable", message: FALLBACK };
  }
}
