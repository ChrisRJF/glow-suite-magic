// Active: used by create-auto-revenue-payment. Pure, no I/O.
/** Salon customer payments never use Mollie or platform Viva; only the salon ISV route. */
export function customerPaymentProvider(setting: unknown): "viva_isv" | "deny" {
  return setting === "viva" ? "viva_isv" : "deny";
}

export type AutoRevenueAuth = { ok: true; tenantId: string } | { ok: false; status: 401 | 403; reason: string };

/**
 * create-auto-revenue-payment caller check. Tenant comes from the verified JWT (owner/admin/manager
 * membership) or from a service-role caller; body.user_id must match; body demo flags are ignored.
 */
export function authorizeAutoRevenue(i: {
  isServiceRole: boolean; authUserId: string | null; memberTenantId: string | null; memberRole: string | null;
  bodyUserId: unknown; appointmentOwnerId: string | null; offerOwnerId: string | null;
}): AutoRevenueAuth {
  const body = typeof i.bodyUserId === "string" ? i.bodyUserId : null;
  let tenant: string | null = null;
  if (i.isServiceRole) tenant = body;
  else if (i.authUserId && i.memberTenantId && ["eigenaar", "admin", "manager"].includes(String(i.memberRole))) tenant = i.memberTenantId;
  if (!tenant) return { ok: false, status: 401, reason: "unauthorized" };
  if (body !== tenant) return { ok: false, status: 403, reason: "tenant_mismatch" };
  if (i.appointmentOwnerId !== tenant || i.offerOwnerId !== tenant) return { ok: false, status: 403, reason: "cross_tenant" };
  return { ok: true, tenantId: tenant };
}
