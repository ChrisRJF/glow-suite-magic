// Klantdossier P2b-1 — marketing consent (append-only history).
//
// Actions (staff JWT required):
//   status   -> current derived status per scope for one customer
//   history  -> append-only consent events (dossier content roles only)
//   grant    -> record a new "granted" event
//   withdraw -> record a new "withdrawn" event
//
// Nothing is ever updated or deleted: the current status is derived server side
// from the newest event per scope.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const SCOPES = ["marketing_general", "advertising"] as const;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Ctx {
  tenantId: string;
  actorId: string;
  isDemo: boolean;
  mayViewStatus: boolean;
  mayViewHistory: boolean;
  mayManage: boolean;
}

async function resolveContext(req: Request): Promise<Ctx | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return null;
  const [{ data: tenantId }, { data: status }, { data: history }, { data: manage }, { data: isDemo }] =
    await Promise.all([
      userClient.rpc("current_tenant_id"),
      userClient.rpc("can_view_dossier_status"),
      userClient.rpc("can_view_consent_history"),
      userClient.rpc("can_manage_consent"),
      userClient.rpc("current_tenant_is_demo"),
    ]);
  if (!tenantId) return null;
  return {
    tenantId: String(tenantId),
    actorId: userData.user.id,
    isDemo: isDemo === true,
    mayViewStatus: status === true,
    mayViewHistory: history === true,
    mayManage: manage === true,
  };
}

async function ownedCustomer(ctx: Ctx, customerId: string) {
  const { data } = await admin
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("user_id", ctx.tenantId)
    .maybeSingle();
  return data?.id ?? null;
}

async function statusFor(customerId: string) {
  const entries = await Promise.all(
    SCOPES.map(async (scope) => {
      const { data } = await admin.rpc("current_consent_status", { _customer_id: customerId, _scope: scope });
      return [scope, String(data ?? "not_given")] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<string, string>;
}

async function record(ctx: Ctx, body: Record<string, unknown>, event: "granted" | "withdrawn") {
  if (!ctx.mayManage) return json({ error: "forbidden" }, 403);

  const customerId = String(body.customer_id ?? "");
  const scope = String(body.scope ?? "");
  if (!SCOPES.includes(scope as typeof SCOPES[number])) return json({ error: "invalid_scope" }, 400);
  if (!(await ownedCustomer(ctx, customerId))) return json({ error: "customer_not_found" }, 404);

  const note = body.note ? String(body.note).replace(/[<>]/g, "").slice(0, 300) : null;
  const current = await admin.rpc("current_consent_status", { _customer_id: customerId, _scope: scope });
  if (String(current.data ?? "not_given") === event) {
    return json({ ok: true, unchanged: true, status: await statusFor(customerId) });
  }

  const { error } = await admin.from("customer_consents").insert({
    user_id: ctx.tenantId,
    is_demo: ctx.isDemo,
    customer_id: customerId,
    consent_type: "marketing_media",
    scope,
    event,
    source: "salon",
    actor_id: ctx.actorId,
    note,
  });
  if (error) {
    console.error("consent_insert_failed", error.message);
    return json({ error: "save_failed" }, 500);
  }

  if (event === "withdrawn") {
    // Withdrawal immediately blocks any future marketing use of this customer's photos.
    await admin
      .from("clinical_media")
      .update({ marketing_approved: false, marketing_approved_at: null, marketing_approved_by: null })
      .eq("user_id", ctx.tenantId)
      .eq("customer_id", customerId)
      .eq("marketing_approved", true);
  }

  await admin.from("audit_logs").insert({
    user_id: ctx.tenantId,
    actor_user_id: ctx.actorId,
    action: event === "granted" ? "consent_granted" : "consent_withdrawn",
    target_type: "customer_consent",
    target_id: customerId,
    is_demo: ctx.isDemo,
    details: { scope, source: "salon" },
  }).then(() => {}, () => {});

  return json({ ok: true, status: await statusFor(customerId) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const ctx = await resolveContext(req);
    if (!ctx) return json({ error: "unauthorized" }, 401);

    const customerId = String(body.customer_id ?? "");

    if (action === "status") {
      if (!ctx.mayViewStatus) return json({ error: "forbidden" }, 403);
      if (!(await ownedCustomer(ctx, customerId))) return json({ error: "customer_not_found" }, 404);
      return json({ ok: true, status: await statusFor(customerId), may_manage: ctx.mayManage });
    }

    if (action === "history") {
      if (!ctx.mayViewHistory) return json({ error: "forbidden" }, 403);
      if (!(await ownedCustomer(ctx, customerId))) return json({ error: "customer_not_found" }, 404);
      const { data } = await admin
        .from("customer_consents")
        .select("id, scope, event, occurred_at, source, version, note")
        .eq("user_id", ctx.tenantId)
        .eq("customer_id", customerId)
        .eq("is_demo", ctx.isDemo)
        .order("occurred_at", { ascending: false })
        .limit(100);
      return json({ ok: true, events: data ?? [] });
    }

    if (action === "grant") return await record(ctx, body, "granted");
    if (action === "withdraw") return await record(ctx, body, "withdrawn");

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    console.error("customer_consents_error", (e as Error).message);
    return json({ error: "server_error" }, 500);
  }
});
