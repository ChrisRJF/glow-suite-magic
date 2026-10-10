// INACTIVE: prepared authorization guard for send-white-label-email.
// Not imported by any entrypoint. Activation requires separate approval.

export type EmailAuthDeps = {
  serviceRoleKey: string;
  /** Verify a user JWT server-side; returns user id or null. */
  verifyUser: (jwt: string) => Promise<string | null>;
  /** Resolve tenant (salon owner user_id) for the verified user; null if none/ambiguous. */
  tenantForUser: (userId: string) => Promise<string | null>;
  /** Roles of the verified user within that tenant. */
  rolesForUser: (userId: string) => Promise<string[] | null>;
};

export type EmailAuthResult =
  | { ok: true; caller: "service" | "user"; tenantId: string }
  | { ok: false; status: 401 | 403 | 500; error: string };

export const EMAIL_ROLES = new Set(["eigenaar", "admin", "manager"]);

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length || a.length === 0) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Authorize a request. Applies identically to preview_only and real sends.
 * requestedUserId is the body's user_id; it is never trusted on its own.
 */
export async function authorizeEmailRequest(
  authHeader: string | null,
  requestedUserId: string,
  deps: EmailAuthDeps,
): Promise<EmailAuthResult> {
  const m = /^Bearer\s+(.+)$/i.exec(authHeader ?? "");
  if (!m) return { ok: false, status: 401, error: "unauthenticated" };
  const token = m[1].trim();

  // Existing internal automations call with the service-role key: keep them working.
  if (deps.serviceRoleKey && timingSafeEqual(token, deps.serviceRoleKey)) {
    return { ok: true, caller: "service", tenantId: requestedUserId };
  }

  try {
    const uid = await deps.verifyUser(token);
    if (!uid) return { ok: false, status: 401, error: "unauthenticated" };
    const tenant = await deps.tenantForUser(uid);
    if (!tenant || tenant !== requestedUserId) return { ok: false, status: 403, error: "forbidden" };
    const roles = await deps.rolesForUser(uid);
    if (!roles || !roles.some((r) => EMAIL_ROLES.has(r))) return { ok: false, status: 403, error: "forbidden" };
    return { ok: true, caller: "user", tenantId: tenant };
  } catch {
    return { ok: false, status: 500, error: "auth_unavailable" };
  }
}
