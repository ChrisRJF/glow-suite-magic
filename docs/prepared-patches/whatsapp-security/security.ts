// Prepared only. Deployment target: supabase/functions/_shared/whatsappSecurity.ts.
import { authorizeWhatsAppSend } from "../../../supabase/functions/_shared/inactive/whatsappSendAuth.ts";

export async function isServiceBearer(header: string | null, expected: string | undefined): Promise<boolean> {
  const token = /^Bearer\s+(\S+)$/i.exec(header || "")?.[1];
  if (!token || !expected) return false;
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(token), digest(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Mirrors the existing tenantOfUser/roleInTenant adapter, without activating
// its proposed nonce, STOP or Meta schema dependencies.
export async function authorizeSendRequest(req: Request, body: any, admin: any, serviceKey: string) {
  const service = await isServiceBearer(req.headers.get("Authorization"), serviceKey);
  let identity: any = { kind: "service" };
  let role: any = null;
  let tenant = body.user_id;
  if (!service) {
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get("Authorization") || "")?.[1];
    if (!bearer) return { allow: false, status: 401, reason: "unauthenticated" };
    const { data, error } = await admin.auth.getUser(bearer);
    if (error || !data?.user) return { allow: false, status: 401, reason: "unauthenticated" };
    const uid = data.user.id;
    identity = { kind: "user", userId: uid };
    const roles = await admin.from("user_roles").select("role").eq("user_id", uid);
    if (roles.error) return { allow: false, status: 403, reason: "role_lookup_failed" };
    if ((roles.data || []).some((r: any) => r.role === "eigenaar")) {
      tenant = uid; role = "eigenaar";
    } else {
      const access = await admin.from("user_access").select("owner_user_id, role").eq("member_user_id", uid).eq("status", "active");
      if (access.error || access.data?.length !== 1) return { allow: false, status: 403, reason: "tenant_unresolved" };
      tenant = access.data[0].owner_user_id;
      role = access.data[0].role;
      if (!["eigenaar", "manager", "admin", "medewerker", "receptie"].includes(role)) return { allow: false, status: 403, reason: "role_not_allowed" };
    }
    if (body.user_id !== undefined && body.user_id !== tenant) return { allow: false, status: 403, reason: "tenant_mismatch" };
  }
  const decision = authorizeWhatsAppSend({ identity, bodyUserId: tenant, bodyTest: body.test, roleInTenant: role, customerInTenant: null });
  if (!decision.allow) return decision;
  if (body.customer_id) {
    const c = await admin.from("customers").select("id, user_id, phone").eq("id", body.customer_id).eq("user_id", tenant).maybeSingle();
    const digits = (s: unknown) => String(s || "").replace(/[^\d]/g, "").replace(/^0/, "31");
    if (c.error || !c.data || c.data.user_id !== tenant || !digits(c.data.phone) || digits(c.data.phone) !== digits(body.to)) return { allow: false, status: 403, reason: "customer_recipient_mismatch" };
  }
  if (body.appointment_id) {
    const a = await admin.from("appointments").select("id, user_id, customer_id").eq("id", body.appointment_id).eq("user_id", tenant).maybeSingle();
    if (a.error || !a.data || a.data.user_id !== tenant || !body.customer_id || a.data.customer_id !== body.customer_id) return { allow: false, status: 403, reason: "appointment_tenant_mismatch" };
  }
  return decision;
}

// Legacy reminder logs without a snapshot cannot prove the body is current.
export function retryAppointmentVerdict(row: any, appointment: any): string | null {
  if (!appointment || appointment.user_id !== row.user_id || appointment.customer_id !== row.customer_id) return "appointment_no_longer_valid";
  if (appointment.status === "geannuleerd" || appointment.status === "cancelled" || appointment.confirmation_status === "declined") return "appointment_no_longer_valid";
  const snapshot = row.meta?.appointment_snapshot;
  if (!snapshot || typeof snapshot.appointment_date !== "string" || typeof snapshot.start_time !== "string" || !snapshot.start_time) return "appointment_snapshot_missing";
  if (snapshot.appointment_date !== appointment.appointment_date || snapshot.start_time !== appointment.start_time) return "appointment_changed";
  return null;
}
