// PREPARED ONLY. Not wired into the scheduler candidate or any active function.
// The supported scheduler verifier is deliberately absent by default. A supplied
// verifier must validate platform identity, not syntax, body fields or decoded JWTs.
import { authorizeSendRequest } from "./security.ts";

type Decision =
  | { allow: false; status: number; reason: string }
  | { allow: true; route: "probe"; tenantId: string }
  | { allow: true; route: "manual"; tenantId: string; appointmentId: string }
  | { allow: true; route: "scheduled" };

export async function authorizeSchedulerProposal(
  req: Request,
  authOnlyClient: any,
  verifyScheduler?: (request: Request) => Promise<boolean>,
): Promise<Decision> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") || "")?.[1];
  if (!bearer) return { allow: false, status: 401, reason: "unauthenticated" };
  let scheduled = false;
  try { scheduled = verifyScheduler ? await verifyScheduler(req) : false; }
  catch { return { allow: false, status: 401, reason: "scheduler_auth_unavailable" }; }

  // User authentication uses only auth/role/membership reads. No business data,
  // run rows, locks or provider calls are allowed until this gate succeeds.
  let userAuth;
  if (!scheduled) {
    try { userAuth = await authorizeSendRequest(req, {}, authOnlyClient, ""); }
    catch { return { allow: false, status: 401, reason: "authentication_unavailable" }; }
    if (!userAuth.allow) return userAuth;
  }
  if (req.method !== "POST") return { allow: false, status: 405, reason: "method_not_allowed" };
  let body: unknown;
  try { body = await req.json(); }
  catch { return { allow: false, status: 400, reason: "invalid_body" }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { allow: false, status: 400, reason: "invalid_body" };
  const input = body as Record<string, unknown>;
  // Only the current {} probe or single-appointment test contract is accepted.
  if (Object.keys(input).some(k => k !== "test_appointment_id")) return { allow: false, status: 400, reason: "unsupported_scheduler_input" };
  if (scheduled) {
    if (Object.keys(input).length) return { allow: false, status: 403, reason: "manual_test_requires_user" };
    return { allow: true, route: "scheduled" };
  }
  if (!userAuth?.allow) return { allow: false, status: 401, reason: "unauthenticated" };
  // Reuse the existing role-derived decision: test=true limits transport tests
  // to owner/admin. Appointment reminder tests also allow manager, as before.
  const roles = await authOnlyClient.from("user_roles").select("role").eq("user_id", userAuth.tenantId);
  // Tenant owner is not necessarily the caller. Resolve caller's permission
  // via the existing helper, which permits owner/admin for its test flag.
  // For manager compatibility, explicit membership must be checked separately.
  if (roles.error) return { allow: false, status: 403, reason: "role_lookup_failed" };
  const { data, error } = await authOnlyClient.auth.getUser(bearer);
  if (error || !data?.user) return { allow: false, status: 401, reason: "unauthenticated" };
  const uid = data.user.id;
  const own = uid === userAuth.tenantId && (roles.data || []).some((r: any) => r.role === "eigenaar");
  if (!own) {
    const membership = await authOnlyClient.from("user_access").select("role").eq("member_user_id", uid).eq("owner_user_id", userAuth.tenantId).eq("status", "active");
    if (membership.error || membership.data?.length !== 1 || !["eigenaar", "manager", "admin"].includes(membership.data[0].role)) return { allow: false, status: 403, reason: "manual_role_not_allowed" };
  }
  if (!Object.keys(input).length) return { allow: true, route: "probe", tenantId: userAuth.tenantId };
  if (typeof input.test_appointment_id !== "string" || !input.test_appointment_id.trim()) return { allow: false, status: 400, reason: "invalid_appointment_id" };
  const appointment = await authOnlyClient.from("appointments").select("id, user_id").eq("id", input.test_appointment_id).eq("user_id", userAuth.tenantId).maybeSingle();
  if (appointment.error || !appointment.data || appointment.data.user_id !== userAuth.tenantId) return { allow: false, status: 403, reason: "appointment_tenant_mismatch" };
  return { allow: true, route: "manual", tenantId: userAuth.tenantId, appointmentId: input.test_appointment_id };
}