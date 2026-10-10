// INACTIVE: the single path that both the real send and the admin preview use
// to authorize and build customer email links. Not imported by any entrypoint.
import { authorizeEmailRequest, type EmailAuthDeps } from "./emailSendAuth.ts";
import { buildCustomerEmailLinks, type CustomerEmailLinks } from "./emailLinks.ts";

export type PrepareDeps = EmailAuthDeps & {
  /** Stored public_slug for the authorized tenant (settings.public_slug). */
  publicSlugForTenant: (tenantId: string) => Promise<string | null>;
};

export type PrepareResult =
  | { ok: true; caller: "service" | "user"; tenantId: string; links: CustomerEmailLinks }
  | { ok: false; status: number; error: string };

export async function prepareCustomerEmail(
  authHeader: string | null,
  body: { user_id?: unknown; template_data?: Record<string, unknown> },
  deps: PrepareDeps,
): Promise<PrepareResult> {
  const requested = typeof body.user_id === "string" ? body.user_id : "";
  if (!requested) return { ok: false, status: 400, error: "invalid_request" };
  const auth = await authorizeEmailRequest(authHeader, requested, deps);
  if (!auth.ok) return { ok: false, status: auth.status, error: auth.error };
  let slug: string | null;
  try { slug = await deps.publicSlugForTenant(auth.tenantId); } catch { return { ok: false, status: 500, error: "settings_unavailable" }; }
  // Caller-supplied salon_slug, manage_url, calendar_url, contact/terms urls are ignored.
  const links = buildCustomerEmailLinks({ publicSlug: slug, bookingToken: body.template_data?.booking_token });
  return { ok: true, caller: auth.caller, tenantId: auth.tenantId, links };
}
