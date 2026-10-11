// Scheduled Edge Function `manual-confirmation-worker` (test phase: Studio Nova only, see secrets below).
// Lives under docs/ on purpose: it is NOT deployed. Copy to supabase/functions/manual-confirmation-worker/
// only after separate approval, together with the per-tenant claim migration
// (docs/proposed-migrations/2026-10-11_manual_confirmation_worker_scope.sql).
//
// Caller: only the scheduler with the service-role key (exact compare). No browser input is used:
// no tenant, recipient or appointment is read from the request.
// Test-phase scope comes from server secrets, fail closed:
//   MANUAL_CONFIRMATION_TENANTS     = 5dbfcbd4-48ff-4010-a1cc-07ed737880ce
//   MANUAL_CONFIRMATION_RECIPIENTS  = chrisrjfrancois@hotmail.com
// Empty/missing = nothing processed / nobody receives mail.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import postgres from "https://deno.land/x/postgresjs@v3.4.4/mod.js";
import { processOutbox, interpretSenderReply, type OutboxRow, type Outcome } from "./manualConfirmationWorker.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** Scheduler auth: the x-worker-secret header must equal the private Vault secret
 *  'manual_confirmation_worker_cron', read server-side via the direct DB connection. Never public. */
async function isSchedulerSecret(secret: string): Promise<boolean> {
  const dbUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";
  if (!dbUrl || secret.length < 32 || secret.length > 256) return false;
  const sql = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 5, connect_timeout: 5 });
  try {
    const rows = await sql`select decrypted_secret from vault.decrypted_secrets where name = 'manual_confirmation_worker_cron' limit 1`;
    const stored = (rows[0]?.decrypted_secret as string | undefined) ?? "";
    return stored.length >= 32 && sameSecret(secret, stored);
  } catch { return false; } finally { await sql.end({ timeout: 2 }).catch(() => {}); }
}

Deno.serve(async (req) => {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Only the service-role key or the private scheduler secret. Public anon keys and user logins are refused.
  const viaCron = await isSchedulerSecret(req.headers.get("x-worker-secret") ?? "");
  if (!url || !key || !(viaCron || sameSecret(bearer, key))) return new Response(JSON.stringify({ error: "Niet toegestaan" }), { status: 401 });

  const tenants = new Set(list(Deno.env.get("MANUAL_CONFIRMATION_TENANTS")).filter((t) => UUID.test(t)));
  const recipients = new Set(list(Deno.env.get("MANUAL_CONFIRMATION_RECIPIENTS")));
  if (tenants.size === 0 || recipients.size === 0) return Response.json({ processed: 0, reason: "scope_empty" });

  const db = createClient(url, key, { auth: { persistSession: false } });
  const one = async <T>(q: PromiseLike<{ data: T | null; error: unknown }>) => { const r = await q; if (r.error) throw r.error; return r.data; };

  // One run at a time; an overlapping tick does nothing.
  const lock = await db.rpc("try_acquire_scheduler_lock", { _name: "manual-confirmation-worker", _ttl_seconds: 240, _holder: crypto.randomUUID() });
  if (lock.error || lock.data !== true) return Response.json({ processed: 0, reason: "locked" });
  try {
  const summary = await processOutbox({
    allowedTenants: tenants,
    claim: async (tenantId, limit, lease) =>
      (await one(db.rpc("claim_manual_confirmations_for_tenant", { _tenant_id: tenantId, _limit: limit, _lease_seconds: lease }))) as OutboxRow[] ?? [],
    finish: async (id, attempt, outcome: Outcome, reason) =>
      (await one(db.rpc("finish_manual_confirmation", { _appointment_id: id, _attempt: attempt, _outcome: outcome, _reason: reason }))) === true,
    tenantIsDemo: async (tenantId) => {
      const r = await db.from("settings").select("is_demo, demo_mode").eq("user_id", tenantId).maybeSingle();
      if (r.error || !r.data) return null;
      return r.data.is_demo === true || r.data.demo_mode === true;
    },
    core: {
      allowedRecipients: recipients,
      rendererTokenOnlyManageLink: true, // live sender only renders a manage button for a valid token
      loadAppointment: async (t, id) => one(db.from("appointments").select("id,user_id,is_demo,status,source,customer_id,service_id,appointment_date,start_time,end_time,booking_token,booking_reference,payment_status").eq("id", id).eq("user_id", t).maybeSingle()),
      // No FK appointment_employees -> employees: two separate queries, both limited to the same salon.
      loadEmployeeLinks: async (id, t) => {
        const links = ((await one(db.from("appointment_employees").select("employee_id,is_primary").eq("appointment_id", id).eq("user_id", t))) as any[] | null) ?? [];
        if (links.length === 0) return [];
        const emps = ((await one(db.from("employees").select("id,name").eq("user_id", t).in("id", links.map((l) => l.employee_id)))) as any[] | null) ?? [];
        const names = new Map(emps.map((e) => [e.id, e.name ?? null]));
        return links.map((l) => ({ employee_id: l.employee_id, is_primary: l.is_primary === true, name: names.get(l.employee_id) ?? null }));
      },
      loadCustomer: async (t, id) => {
        const c = (await one(db.from("customers").select("name,email,preferred_language").eq("id", id).eq("user_id", t).maybeSingle())) as any;
        return c ? { name: c.name ?? null, email: c.email ?? null, language: c.preferred_language ?? null } : null;
      },
      loadService: async (t, id) => one(db.from("services").select("name").eq("id", id).eq("user_id", t).maybeSingle()),
      loadSalon: async (t) => one(db.from("settings").select("salon_name,public_slug,demo_mode,is_demo").eq("user_id", t).maybeSingle()),
      emailAllowed: async (t, c) => {
        const r = await db.from("customer_message_preferences").select("email_opt_out").eq("user_id", t).eq("customer_id", c).maybeSingle();
        if (r.error) throw r.error;           // technical -> defer, never treated as opt-out
        return r.data ? r.data.email_opt_out !== true : true;
      },
      sendingAllowed: async () => {
        const r = await db.from("customer_email_controls").select("sending_enabled").eq("id", true).maybeSingle();
        if (r.error || !r.data) throw r.error ?? new Error("controls_missing"); // unreadable -> defer
        return r.data.sending_enabled === true;
      },
      send: async (payload) => {
        try {
          const res = await fetch(`${url}/functions/v1/send-white-label-email`, {
            method: "POST", signal: AbortSignal.timeout(20_000),
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify(payload),
          });
          const body = await res.json().catch(() => null);
          return interpretSenderReply(res.status, body);
        } catch { return { ok: false, uncertain: true }; }
      },
    },
  });
  return Response.json(summary);
  } finally {
    await db.rpc("release_scheduler_lock", { _name: "manual-confirmation-worker" });
  }
});
