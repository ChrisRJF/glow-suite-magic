// PREPARED replacement for supabase/functions/send-white-label-email/index.ts (NOT deployed).
// Activation: see RELEASE.md. Requires modules moved from _shared/inactive/ to _shared/.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { createCustomerEmailHandler } from "../_shared/customerEmailHandler.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const one = async (q: PromiseLike<{ data: any; error: any }>) => { const { data, error } = await q; if (error) throw error; return data; };

let currentJwt = ""; // set per request below; only used by tenantForUser of the same request

const handler = createCustomerEmailHandler({
  serviceRoleKey: SERVICE,
  // Fresh query every call; error -> throw -> blocked.
  readStopSwitch: () => one(admin.from("customer_email_controls").select("sending_enabled").eq("id", true).maybeSingle()),
  verifyUser: async (jwt) => { currentJwt = jwt; const { data, error } = await admin.auth.getUser(jwt); return error ? null : data.user?.id ?? null; },
  // Existing trusted rule current_tenant_id(), evaluated as the verified user.
  tenantForUser: async () => {
    const c = createClient(URL_, ANON, { global: { headers: { Authorization: `Bearer ${currentJwt}` } }, auth: { persistSession: false } });
    const t = await one(c.rpc("current_tenant_id"));
    return typeof t === "string" ? t : null;
  },
  rolesForUser: async (uid) => ((await one(admin.from("user_roles").select("role").eq("user_id", uid))) ?? []).map((r: any) => r.role),
  recipientAllowed: async (tenant, email) => Boolean(await one(admin.from("customers").select("id").eq("user_id", tenant).ilike("email", email).limit(1).maybeSingle())),
  loadSettings: (tenant) => one(admin.from("settings").select("salon_name, public_slug, whitelabel_branding, demo_mode, is_demo, language, google_review_url").eq("user_id", tenant).order("created_at", { ascending: false }).limit(1).maybeSingle()),
  ownerEmail: async (tenant) => (await one(admin.from("profiles").select("email").eq("user_id", tenant).order("created_at", { ascending: false }).limit(1).maybeSingle()))?.email ?? null,
  customerLanguage: async (tenant, email) => (await one(admin.from("customers").select("preferred_language").eq("user_id", tenant).eq("email", email).limit(1).maybeSingle()))?.preferred_language ?? null,
  tokenForAppointment: async (tenant, id) => (await one(admin.from("appointments").select("booking_token").eq("id", id).eq("user_id", tenant).maybeSingle()))?.booking_token ?? null,
  tokenBelongsToTenant: async (tenant, token) => Boolean(await one(admin.from("appointments").select("id").eq("booking_token", token).eq("user_id", tenant).limit(1).maybeSingle())),
  log: async (row) => { await admin.from("white_label_email_logs").insert(row as any); },
  sendEmail: async (m) => {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY"); const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!LOVABLE_API_KEY || !RESEND_API_KEY) return { ok: false };
    const r = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "X-Connection-Api-Key": RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, ...(m.replyTo ? { reply_to: m.replyTo } : {}), headers: { "Idempotency-Key": m.idempotencyKey } }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, id: j?.id || j?.data?.id || null };
  },
});

Deno.serve(handler);
