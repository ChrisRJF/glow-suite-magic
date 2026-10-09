// Blocks legacy SaaS checkout/manage routes for accounts with an agreed free
// period (subscriptions.free_period_starts_at set). Tenant-scoped via data,
// no hardcoded emails.
// deno-lint-ignore no-explicit-any
type Admin = any;

export const BILLING_LOCKED_MESSAGE =
  "Voor dit account is een gratis periode afgesproken. Abonnementen kunnen nog niet online worden afgesloten.";

export async function isBillingLockedForUser(admin: Admin, userId: string): Promise<boolean> {
  const { data } = await admin
    .from("subscriptions")
    .select("free_period_starts_at")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data?.free_period_starts_at;
}

export async function isBillingLockedForEmail(admin: Admin, email: string): Promise<boolean> {
  const { data: profiles } = await admin
    .from("profiles")
    .select("user_id")
    .ilike("email", email);
  for (const p of profiles ?? []) {
    if (await isBillingLockedForUser(admin, p.user_id)) return true;
  }
  return false;
}

export function billingLockedResponse(corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify({ error: BILLING_LOCKED_MESSAGE, code: "billing_locked" }), {
    status: 403,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
