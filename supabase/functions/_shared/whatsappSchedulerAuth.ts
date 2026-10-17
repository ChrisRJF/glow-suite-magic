// Active scheduler authentication gate for whatsapp-reminder-scheduler.
// One gate, three routes, decided BEFORE any run row, lease, settings read or
// dispatch. Prepared as docs/prepared-patches/whatsapp-security/schedulerAuth.proposal.ts.
//
// - scheduled: only the dedicated server-only cron secret (constant-time
//   digest comparison). Unset secret => no scheduled route can ever pass.
//   The scheduled route accepts only an empty {} body.
// - manual: verified user JWT with owner/manager/admin permission in the
//   derived tenant, and the appointment must belong to that tenant.
// - probe: verified user with {} body. Returns no-dispatch; the frontend
//   connection card can keep its request shape without triggering a sweep.
//
// A service transport key is NOT scheduler authority. Trust is never inferred
// from Bearer syntax, a decoded unverified role or a body user_id.
import { isServiceBearer } from "./whatsappSecurity.ts";

export type SchedulerDecision =
  | { allow: false; status: number; reason: string }
  | { allow: true; route: "scheduled" }
  | { allow: true; route: "probe"; tenantId: string }
  | { allow: true; route: "manual"; tenantId: string; appointmentId: string };

const MANUAL_ROLES = ["eigenaar", "manager", "admin"];

export async function authorizeSchedulerRequest(
  req: Request,
  body: unknown,
  authOnlyClient: any,
  cronSecret: string | undefined,
): Promise<SchedulerDecision> {
  if (req.method !== "POST") return { allow: false, status: 405, reason: "method_not_allowed" };
  if (!body || typeof body !== "object" || Array.isArray(body)) return { allow: false, status: 400, reason: "invalid_body" };
  const input = body as Record<string, unknown>;
  // Only the current {} probe / cron contract or the single-appointment test
  // contract is accepted. Unknown fields, including user_id, are rejected.
  if (Object.keys(input).some((k) => k !== "test_appointment_id")) {
    return { allow: false, status: 400, reason: "unsupported_scheduler_input" };
  }

  const header = req.headers.get("Authorization");
  const bearer = /^Bearer\s+(\S+)$/i.exec(header || "")?.[1];
  if (!bearer) return { allow: false, status: 401, reason: "unauthenticated" };

  // Scheduled route: dedicated cron secret only, never the transport key.
  let scheduled = false;
  try {
    scheduled = await isServiceBearer(header, cronSecret);
  } catch {
    return { allow: false, status: 401, reason: "scheduler_auth_unavailable" };
  }
  if (scheduled) {
    if (Object.keys(input).length) return { allow: false, status: 403, reason: "manual_test_requires_user" };
    return { allow: true, route: "scheduled" };
  }

  // User route: verified identity, then tenant derivation. Authentication-only
  // reads (auth/roles/membership/appointment scope) happen before the gate
  // returns; no business writes, leases or dispatch may precede it.
  let uid: string;
  try {
    const { data, error } = await authOnlyClient.auth.getUser(bearer);
    if (error || !data?.user?.id) return { allow: false, status: 401, reason: "unauthenticated" };
    uid = data.user.id;
  } catch {
    return { allow: false, status: 401, reason: "authentication_unavailable" };
  }

  const roles = await authOnlyClient.from("user_roles").select("role").eq("user_id", uid);
  if (roles.error) return { allow: false, status: 403, reason: "role_lookup_failed" };

  let tenantId: string;
  let role: string;
  if ((roles.data || []).some((r: any) => r.role === "eigenaar")) {
    tenantId = uid;
    role = "eigenaar";
  } else {
    const membership = await authOnlyClient
      .from("user_access")
      .select("owner_user_id, role")
      .eq("member_user_id", uid)
      .eq("status", "active");
    if (membership.error || membership.data?.length !== 1) {
      return { allow: false, status: 403, reason: "tenant_unresolved" };
    }
    tenantId = membership.data[0].owner_user_id;
    role = membership.data[0].role;
  }
  if (!MANUAL_ROLES.includes(role)) return { allow: false, status: 403, reason: "manual_role_not_allowed" };

  if (!Object.keys(input).length) return { allow: true, route: "probe", tenantId };

  if (typeof input.test_appointment_id !== "string" || !input.test_appointment_id.trim()) {
    return { allow: false, status: 400, reason: "invalid_appointment_id" };
  }
  const appointment = await authOnlyClient
    .from("appointments")
    .select("id, user_id")
    .eq("id", input.test_appointment_id)
    .eq("user_id", tenantId)
    .maybeSingle();
  if (appointment.error || !appointment.data || appointment.data.user_id !== tenantId) {
    return { allow: false, status: 403, reason: "appointment_tenant_mismatch" };
  }
  return { allow: true, route: "manual", tenantId, appointmentId: input.test_appointment_id };
}
