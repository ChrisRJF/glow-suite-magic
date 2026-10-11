// Edge Function `agenda-create-appointment` (Agenda 3.0 step 3A). Deployed; NOT used by the frontend yet.
// Writes only when tenant_feature_flags.atomic_agenda_enabled is true for the resolved salon.
//
// Security:
// - The user is verified with Supabase Auth (auth.getUser(jwt)): signature, expiry and revocation are checked
//   by the Auth server. A decoded but unverified JWT is never used.
// - The actor id comes only from that verified user. Salon, role and demo mode are read server-side.
// - SUPABASE_SERVICE_ROLE_KEY stays in the function environment; it is never returned or logged.
// - The only write is rpc("create_appointment_atomic_as"), which re-checks salon, role, flag and membership.
// - Confirmation mail is NOT connected here (onCreated omitted) until the mail activation is approved.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { handleCreate, messageFor, type ActorContext, type RouteDeps } from "./agendaCreateRoute.ts";

// Same CORS pattern as the existing GlowSuite Edge Functions (e.g. public-booking).
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};


function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

export function makeDeps(admin: SupabaseClient, anon: SupabaseClient): RouteDeps {
  return {
    verifyUser: async (jwt) => {
      const { data, error } = await anon.auth.getUser(jwt);
      return error || !data?.user?.id ? null : data.user.id;
    },
    actorContext: async (userId): Promise<ActorContext | null> => {
      const owner = await admin.from("user_roles").select("user_id").eq("user_id", userId).eq("role", "eigenaar").limit(1);
      if (owner.error) throw owner.error;
      let tenantId: string; let role: string; let membershipIsDemo: boolean | null = null;
      if ((owner.data ?? []).length > 0) {
        tenantId = userId; role = "eigenaar";
      } else {
        const m = await admin.from("user_access").select("owner_user_id, role, is_demo, created_at")
          .eq("member_user_id", userId).eq("status", "active").order("created_at", { ascending: true });
        if (m.error) throw m.error;
        const owners = new Set((m.data ?? []).map((r: any) => r.owner_user_id));
        if (owners.size !== 1) return null; // none or ambiguous: refuse
        const rows = (m.data ?? []) as any[];
        const modes = new Set(rows.map((r) => r.is_demo === true));
        if (modes.size !== 1) return null; // mixed demo/live memberships for one salon: refuse
        tenantId = rows[0].owner_user_id; role = String(rows[0].role); membershipIsDemo = rows[0].is_demo === true;
      }
      const s = await admin.from("settings").select("is_demo, demo_mode, created_at").eq("user_id", tenantId)
        .order("created_at", { ascending: false }).limit(1);
      if (s.error) throw s.error;
      const row = (s.data ?? [])[0] as any;
      if (!row) return null; // salon without settings: refuse
      return { tenantId, role, salonIsDemo: row.is_demo === true || row.demo_mode === true, membershipIsDemo };
    },
    readFlag: async (tenantId) => {
      const r = await admin.from("tenant_feature_flags").select("atomic_agenda_enabled").eq("tenant_id", tenantId).maybeSingle();
      return { data: r.data, error: r.error };
    },
    callCreateAs: async (actor, _tenantId, args) => {
      const { data, error } = await admin.rpc("create_appointment_atomic_as", { _actor: actor, ...args });
      if (error) throw new Error("rpc_failed"); // outcome unknown: browser retries with the same request_id
      return data;
    },
  };
}

{
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
    if (req.method !== "POST") return json(405, { ok: false, code: "invalid_input", message: messageFor("invalid_input") });
    const auth = req.headers.get("Authorization") ?? "";
    const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    let body: unknown = null;
    try { body = await req.json(); } catch { body = null; }
    const URL_ = Deno.env.get("SUPABASE_URL"); const ANON = Deno.env.get("SUPABASE_ANON_KEY");
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!URL_ || !ANON || !SERVICE) return json(503, { ok: false, code: "unavailable", message: messageFor("unavailable") });
    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
    const anon = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
    const r = await handleCreate({ jwt, body }, makeDeps(admin, anon));
    const { status, ...out } = r;
    return json(status, out);
  });
}
