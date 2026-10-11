// INACTIVE entrypoint draft for Edge Function `appointment-checkout`.
// Activation: copy to supabase/functions/appointment-checkout/index.ts ONLY after the ledger migration and
// the provider patches in docs/prepared-patches/appointment-checkout/README.md are approved and applied.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { handleCheckout, type Deps } from "./appointmentCheckoutCore.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

export function makeDeps(admin: SupabaseClient, anon: SupabaseClient, jwt: string, fnBase: string, anonKey: string): Deps {
  const callFn = async (name: string, body: unknown) => {
    const r = await fetch(`${fnBase}/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => null);
    return { status: r.status, data };
  };
  return {
    verifyUser: async (j) => { const { data, error } = await anon.auth.getUser(j); return error ? null : data?.user?.id ?? null; },
    tenantForUser: async (userId) => {
      const owner = await admin.from("user_roles").select("user_id").eq("user_id", userId).eq("role", "eigenaar").limit(1);
      if (owner.error) throw owner.error;
      let tenantId = userId; let role = "eigenaar";
      if (!(owner.data ?? []).length) {
        const m = await admin.from("user_access").select("owner_user_id, role").eq("member_user_id", userId).eq("status", "active");
        if (m.error) throw m.error;
        const owners = new Set((m.data ?? []).map((r: any) => r.owner_user_id));
        if (owners.size !== 1) return null;
        tenantId = (m.data as any[])[0].owner_user_id; role = String((m.data as any[])[0].role);
      }
      const s = await admin.from("settings").select("is_demo, demo_mode").eq("user_id", tenantId).order("created_at", { ascending: false }).limit(1);
      if (s.error || !s.data?.[0]) return null;
      return { tenantId, role, isDemo: s.data[0].is_demo === true || s.data[0].demo_mode === true };
    },
    flagEnabled: async (tid) => {
      const r = await admin.from("tenant_feature_flags").select("appointment_checkout_enabled").eq("tenant_id", tid).maybeSingle();
      if (r.error) throw r.error;
      return (r.data as any)?.appointment_checkout_enabled === true;
    },
    loadAppointment: async (tid, id) => {
      const r = await admin.from("appointments").select("id, user_id, is_demo, status, customer_id, price, deposit_amount, amount_paid, booking_group_id")
        .eq("id", id).eq("user_id", tid).maybeSingle();
      if (r.error) throw r.error;
      return r.data as any;
    },
    loadPayments: async (tid, aid) => {
      const r = await admin.from("payments").select("id, appointment_id, user_id, amount, status, is_demo, refunded_amount, refunded_at, metadata")
        .eq("user_id", tid).eq("appointment_id", aid);
      // Payment links live in payments.metadata.checkout_url (there is no checkout_url column).
      return r.error ? null : (r.data as any[]).map(({ metadata, ...p }) => ({ ...p, checkout_url: metadata?.checkout_url ?? null }));
    },
    loadLedger: async (tid, aid) => {
      const r = await admin.from("payment_ledger").select("payment_id, tenant_id, appointment_id, kind, amount_cents, currency")
        .eq("tenant_id", tid).eq("appointment_id", aid);
      return r.error ? null : (r.data as any);
    },
    providerReady: async (tid, method, isDemo) => {
      const s = await admin.from("settings").select("viva_demo_enabled, viva_live_enabled").eq("user_id", tid).order("created_at", { ascending: false }).limit(1);
      if (s.error || !s.data?.[0]) return false;
      if (isDemo ? s.data[0].viva_demo_enabled !== true : s.data[0].viva_live_enabled !== true) return false;
      if (method === "terminal") {
        const r = await admin.from("viva_terminals").select("id").eq("user_id", tid).eq("is_demo", isDemo).limit(1);
        return !r.error && (r.data ?? []).length > 0;
      }
      if (isDemo) return true;
      const r = await admin.from("glowpay_connected_merchants").select("id").eq("user_id", tid).limit(1);
      return !r.error && (r.data ?? []).length > 0;
    },
    claim: async (key, tid, aid) => {
      const r = await admin.rpc("claim_appointment_checkout", { _key: key, _tenant_id: tid, _appointment_id: aid, _ttl_seconds: 900 });
      if (r.error) throw r.error;
      return r.data === true;
    },
    attach: async (key, pid) => { await admin.rpc("attach_checkout_claim", { _key: key, _payment_id: pid }); },
    release: async (key) => { await admin.rpc("release_checkout_claim", { _key: key }); },
    startProvider: async (a) => {
      // Reuses the existing provider functions with the caller's own login; amount and demo/live are server-decided.
      let providerTerminalId: string | undefined;
      if (a.method === "terminal") {
        // Browser sends the INTERNAL viva_terminals.id; map it to the provider terminal_id within this salon + mode.
        const t = await admin.from("viva_terminals").select("terminal_id").eq("id", a.terminalId!).eq("user_id", a.tenantId).eq("is_demo", a.isDemo).maybeSingle();
        if (t.error || !t.data?.terminal_id) return { ok: false, definitive: true };
        providerTerminalId = t.data.terminal_id;
      }
      const r = a.method === "terminal"
        ? await callFn("create-viva-terminal-payment", { terminal_id: providerTerminalId, is_demo: a.isDemo, appointment_id: a.appointmentId, customer_id: a.customerId, amount_cents: a.amountCents, tip_cents: 0, idempotency_key: a.idempotencyKey })
        : await callFn("create-viva-payment", { appointment_id: a.appointmentId, customer_id: a.customerId, amount_cents: a.amountCents, payment_type: "appointment_checkout", is_demo: a.isDemo, idempotency_key: a.idempotencyKey });
      const pid = r.data?.payment_id ?? r.data?.id;
      if (r.status >= 200 && r.status < 300 && typeof pid === "string") return { ok: true, paymentId: pid, checkoutUrl: r.data?.checkout_url ?? null };
      return { ok: false, definitive: r.status >= 400 && r.status < 500 };
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { ok: false, message: "Niet toegestaan." });
  const url = Deno.env.get("SUPABASE_URL")!; const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const anon = createClient(url, anonKey, { auth: { persistSession: false } });
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "") || null;
  const body = await req.json().catch(() => ({}));
  // Browser may only send action, appointment_id, method, terminal_id. Salon, amount and mode are server-side.
  const res = await handleCheckout({ jwt, action: body?.action, appointmentId: body?.appointment_id, method: body?.method, terminalId: body?.terminal_id },
    makeDeps(admin, anon, jwt ?? "", `${url}/functions/v1`, anonKey));
  return json(200, res);
});
