// INACTIVE. Authorization decision for whatsapp-send. Pure: identity and
// membership are resolved by the caller (verified JWT claims / DB lookup) and
// injected, so the body's user_id and test flag are never trusted on their own.

export type CallerIdentity =
  | { kind: "anonymous" }
  | { kind: "service" } // JWT verified server-side with role=service_role
  | { kind: "user"; userId: string };

export type TenantRole = "eigenaar" | "admin" | "medewerker" | "financieel" | null;

export interface SendAuthInput {
  identity: CallerIdentity;
  bodyUserId: unknown;
  bodyTest: unknown;
  bodyCustomerId?: unknown;
  /** Role of identity.userId inside tenant bodyUserId (null = no membership). */
  roleInTenant: TenantRole;
  /** Whether bodyCustomerId belongs to tenant bodyUserId (null if no customer given). */
  customerInTenant: boolean | null;
}

export type SendAuthDecision =
  | { allow: true; tenantId: string; test: boolean; via: "service" | "user" }
  | { allow: false; status: 400 | 401 | 403; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function authorizeWhatsAppSend(i: SendAuthInput): SendAuthDecision {
  if (typeof i.bodyUserId !== "string" || !UUID.test(i.bodyUserId)) {
    return { allow: false, status: 400, reason: "invalid_user_id" };
  }
  const tenantId = i.bodyUserId;
  const test = i.bodyTest === true;

  if (i.identity.kind === "anonymous") return { allow: false, status: 401, reason: "unauthenticated" };

  // Customer must always belong to the tenant, also for internal callers.
  if (i.customerInTenant === false) return { allow: false, status: 403, reason: "customer_not_in_tenant" };

  if (i.identity.kind === "service") {
    // Schedulers never need the test bypass.
    if (test) return { allow: false, status: 403, reason: "test_not_allowed_for_service" };
    return { allow: true, tenantId, test: false, via: "service" };
  }

  // User JWT: must be a member of the tenant it claims to send for.
  if (!i.roleInTenant) return { allow: false, status: 403, reason: "not_member_of_tenant" };
  // test=true only skips the "enabled" toggle and only for owner/admin.
  if (test && i.roleInTenant !== "eigenaar" && i.roleInTenant !== "admin") {
    return { allow: false, status: 403, reason: "test_requires_owner_or_admin" };
  }
  return { allow: true, tenantId, test, via: "user" };
}
