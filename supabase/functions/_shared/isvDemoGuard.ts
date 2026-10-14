// Guard rules for the temporary ISV demo order route. Pure and testable.

export const ISV_DEMO_KEY = "isv-demo-step6";
export const ISV_DEMO_AMOUNT_CENTS = 100;

export type Actor = { userId: string | null; isPlatformOwner: boolean; aal: string | null };

export function authorizeDemoActor(a: Actor): "ok" | "unauthenticated" | "forbidden" | "mfa_required" {
  if (!a.userId) return "unauthenticated";
  if (!a.isPlatformOwner) return "forbidden";
  if (a.aal !== "aal2") return "mfa_required";
  return "ok";
}

/** Order creation switch: only the literal "true" enables it. Unset = off. */
export function orderSwitchOn(env: Record<string, string | undefined>): boolean {
  return env.VIVA_ISV_DEMO_ENABLED === "true";
}

/** Read the aal claim from an already server-verified JWT. */
export function aalFromJwt(jwt: string): string | null {
  try {
    const part = jwt.split(".")[1];
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=")));
    return typeof json.aal === "string" ? json.aal : null;
  } catch { return null; }
}

export type Existing = { id: string; status: string; orderCode: string | null; failureReason?: string | null } | null;

/** Allowed by platform_commission_entries_source_check: a server route writes the expected fee. */
export const ISV_DEMO_COMMISSION_SOURCE = "route";

/** Failed before any Viva call: no order can exist, so it never blocks a new, separate attempt. */
export function stoppedBeforeViva(e: NonNullable<Existing>): boolean {
  return e.status === "failed" && !e.orderCode && e.failureReason === "expected_fee_not_recorded";
}

/** Pick the attempt that matters; attempts that provably stopped before Viva are history only. */
export function activeAttempt(rows: NonNullable<Existing>[]): Existing {
  return rows.find((r) => !stoppedBeforeViva(r)) ?? null;
}

/** A repeat request never creates a second order. */
export function idempotencyDecision(existing: Existing): "create" | "return_existing" | "stuck_needs_review" {
  if (!existing) return "create";
  if (existing.orderCode) return "return_existing";
  return "stuck_needs_review";
}
