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

export type Existing = { id: string; status: string; orderCode: string | null } | null;

/** A repeat request never creates a second order. */
export function idempotencyDecision(existing: Existing): "create" | "return_existing" | "stuck_needs_review" {
  if (!existing) return "create";
  if (existing.orderCode) return "return_existing";
  return "stuck_needs_review";
}
