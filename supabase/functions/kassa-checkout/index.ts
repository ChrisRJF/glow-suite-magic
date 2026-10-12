// Edge Function `kassa-checkout`. Inert unless tenant_feature_flags.kassa_orders_enabled = true for the actor's salon.
// Body: { order_id, terminal_id (internal viva_terminals.id) }. Amount, salon, customer and demo/live come only from the database.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { startKassaPayment, type BeginResult } from "../_shared/kassaRoute.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const url = Deno.env.get("SUPABASE_URL")!, anonKey = Deno.env.get("SUPABASE_ANON_KEY")!, serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey);
  const anon = createClient(url, anonKey);
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const body = await req.json().catch(() => null);
  let tenantId: string | null = null;

  const res = await startKassaPayment(body, {
    actor: async () => {
      if (!jwt) return null;
      const { data, error } = await anon.auth.getUser(jwt);
      return error ? null : data?.user?.id ?? null;
    },
    begin: async (actor, orderId): Promise<BeginResult> => {
      const t = await admin.rpc("kassa_actor_tenant", { _actor: actor });
      const row = Array.isArray(t.data) ? t.data[0] : t.data;
      if (t.error || !row?.tenant_id) return { ok: false, reason: "no_access" };
      const f = await admin.from("tenant_feature_flags").select("kassa_orders_enabled").eq("tenant_id", row.tenant_id).maybeSingle();
      if (f.error || (f.data as any)?.kassa_orders_enabled !== true) return { ok: false, reason: "disabled" };
      tenantId = row.tenant_id;
      const r = await admin.rpc("kassa_begin_attempt", { _actor: actor, _order_id: orderId });
      return r.error || !r.data ? { ok: false, reason: "unavailable" } : (r.data as BeginResult);
    },
    startTerminal: async (a) => {
      const t = await admin.from("viva_terminals").select("terminal_id").eq("id", a.terminalId).eq("user_id", a.tenantId).eq("is_demo", a.isDemo).maybeSingle();
      if (t.error || !t.data?.terminal_id) return { ok: false, unclear: false, message: "Pinapparaat niet gevonden in deze salon." };
      try {
        const r = await fetch(`${url}/functions/v1/create-viva-terminal-payment`, {
          method: "POST",
          headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey, "x-glowsuite-checkout": serviceKey, "Content-Type": "application/json" },
          body: JSON.stringify({ kassa_order_id: a.orderId, terminal_id: t.data.terminal_id, idempotency_key: a.idempotencyKey }),
        });
        const d = await r.json().catch(() => null);
        if (r.ok && d?.payment_id) return { ok: true, paymentId: String(d.payment_id) };
        return { ok: false, unclear: r.status >= 500, message: "Betaling kon niet worden gestart. Controleer het pinapparaat." };
      } catch {
        return { ok: false, unclear: true, message: "Onbekende uitkomst. Probeer opnieuw; er wordt geen tweede betaling gestart." };
      }
    },
    attach: async (orderId, key, paymentId) => {
      const r = await admin.rpc("kassa_attach_payment", { _order_id: orderId, _key: key, _payment_id: paymentId });
      return !r.error && r.data === true;
    },
  });
  void tenantId;
  return json(res.status, res.body);
});
