// Demo-only checkout gate. TEMPORARY allowlist for demo UX (The Beautycare Clinic).
// Pure simulation: never creates payments, never writes ledger/appointments/settings.
import { supabase } from "@/integrations/supabase/client";

/** Tijdelijke allowlist voor demo-afrekenen (alleen UX, geen echte betaling). */
export const DEMO_CHECKOUT_TENANTS = new Set(["1c6c885e-c944-4717-b2ef-9cfdb9fa15ae", "cbd7d158-0133-4f2f-a504-4b82f73f2e20"]);
/** Fictieve demosalon (Studio Nova): simulatie mag naast de echte Viva-demo checkout verschijnen. */
const SIDE_BY_SIDE_TENANTS = new Set(["cbd7d158-0133-4f2f-a504-4b82f73f2e20"]);
const ROLES = new Set(["eigenaar", "admin", "manager", "receptie"]);

/** Fail closed: alleen bij exacte tenant uit server-RPC, toegestane rol en echte checkout niet zichtbaar. */
export function demoCheckoutVisible(tenantId: unknown, roles: readonly string[] | null | undefined, realCheckoutVisible: boolean): boolean {
  if (typeof tenantId !== "string" || !DEMO_CHECKOUT_TENANTS.has(tenantId)) return false;
  if (realCheckoutVisible && !SIDE_BY_SIDE_TENANTS.has(tenantId)) return false;
  return (roles ?? []).some((r) => ROLES.has(r));
}

export async function readDemoCheckoutVisible(roles: readonly string[] | null | undefined, realCheckoutVisible: boolean): Promise<boolean> {
  try {
    const t = await supabase.rpc("current_tenant_id");
    if (t.error) return false;
    return demoCheckoutVisible(t.data, roles, realCheckoutVisible);
  } catch { return false; }
}
