// GA access for LIVE ISV create (replaces the former per-user pilot allowlist).
// Imported by isvLiveCreate.ts. VIVA_ISV_LIVE_ENABLED stays the global kill switch.

export interface LiveTenantFacts {
  authEmail: string | null;     // from the verified auth session, never from the request body
  emailConfirmed: boolean;
  isOwner: boolean;             // has_role(uid,'eigenaar'), server-side
  settingsFound: boolean;
  isDemo: boolean;              // settings.is_demo OR settings.demo_mode
  salonName: string | null;     // settings.salon_name
}

export const LIVE_CREATE_MAX_ATTEMPTS_PER_HOUR = 3;
export const LIVE_CREATE_RATE_WINDOW_SECONDS = 3600;

export type LiveAccess = { ok: true; email: string; salonName: string } | { ok: false; status: number; error: string };

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** Fail-closed GA eligibility. Any unknown fact means no create. */
export function liveCreateAccess(f: LiveTenantFacts | null | "error"): LiveAccess {
  if (!f || f === "error") return { ok: false, status: 503, error: "unavailable" };
  const email = String(f.authEmail ?? "").trim();
  if (!email || email.length > 254 || !EMAIL.test(email)) return { ok: false, status: 400, error: "invalid_email" };
  if (f.emailConfirmed !== true) return { ok: false, status: 403, error: "email_not_confirmed" };
  if (f.isOwner !== true) return { ok: false, status: 403, error: "owner_required" };
  if (f.settingsFound !== true) return { ok: false, status: 409, error: "setup_incomplete" };
  if (f.isDemo !== false) return { ok: false, status: 403, error: "demo_account" };
  const salonName = String(f.salonName ?? "").trim();
  if (!salonName) return { ok: false, status: 409, error: "salon_name_required" };
  return { ok: true, email, salonName };
}
