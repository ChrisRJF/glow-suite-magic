// PREPARED ONLY (GA access). No active entrypoint imports this module yet.
// Replaces the per-user pilot allowlist with server-side tenant eligibility.
// VIVA_ISV_LIVE_ENABLED stays the global kill switch (checked elsewhere first).

export interface LiveTenantFacts {
  sessionUserId: string;
  emailConfirmed: boolean;
  isOwner: boolean;             // has_role(uid,'eigenaar'), server-side
  settingsFound: boolean;
  isDemo: boolean;              // settings.is_demo OR settings.demo_mode
  salonName: string | null;
  recentAttempts: number;       // create attempts by this user in the rate window
}

export const LIVE_CREATE_MAX_ATTEMPTS_PER_HOUR = 3;

export type LiveAccess = { ok: true } | { ok: false; status: number; error: string };

/** Fail-closed GA eligibility. Any unknown fact means no create. */
export function liveCreateAccess(f: LiveTenantFacts | null): LiveAccess {
  if (!f) return { ok: false, status: 503, error: "unavailable" };
  if (!f.emailConfirmed) return { ok: false, status: 403, error: "email_not_confirmed" };
  if (!f.isOwner) return { ok: false, status: 403, error: "owner_required" };
  if (!f.settingsFound) return { ok: false, status: 409, error: "setup_incomplete" };
  if (f.isDemo) return { ok: false, status: 403, error: "demo_account" };
  if (!f.salonName || !f.salonName.trim()) return { ok: false, status: 409, error: "salon_name_required" };
  if (!Number.isInteger(f.recentAttempts) || f.recentAttempts < 0) return { ok: false, status: 503, error: "unavailable" };
  if (f.recentAttempts >= LIVE_CREATE_MAX_ATTEMPTS_PER_HOUR) return { ok: false, status: 429, error: "rate_limited" };
  return { ok: true };
}

/** GA always sends the verified auth email, never a client-supplied address. */
export function liveContactEmail(authEmail: string | null | undefined): string | null {
  const e = String(authEmail ?? "").trim();
  return e && e.length <= 254 ? e : null;
}
