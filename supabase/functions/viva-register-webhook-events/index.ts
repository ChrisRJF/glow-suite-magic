// One-shot admin endpoint: registers required webhook event subscriptions with
// Viva for both ISVPaymentAPI (Smart Checkout) and ISVCloudTerminalAPI (POS).
//
// Subscribes the following EventTypes against the GlowSuite webhook URL:
//   1796 - Transaction Payment Created
//   1797 - Transaction Reversal Created
//   1798 - Transaction Refund Created (best effort)
//
// Usage (auth required, eigenaar/admin):
//   POST /viva-register-webhook-events  { event_type_ids?: number[] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { getVivaAccessToken, getVivaPosAccessToken, vivaEnv, vivaPosEnv } from "../_shared/viva.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const DEFAULT_EVENTS = [1796, 1797, 1798];

async function registerEvent(apiBase: string, token: string, eventTypeId: number, webhookUrl: string) {
  // Viva Webhook Verification & Subscription API:
  //   POST {api}/api/messages/config  body: { Url, EventTypeId, Active }
  const res = await fetch(`${apiBase}/api/messages/config`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ Url: webhookUrl, EventTypeId: eventTypeId, Active: true }),
  });
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, ok: res.ok, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return json({ error: "unauthorized" }, 401);

  const { data: isOwner } = await supabase.rpc("has_role", { _user_id: userId, _role: "eigenaar" });
  const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (!isOwner && !isAdmin) return json({ error: "forbidden" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const eventTypeIds: number[] = Array.isArray(body?.event_type_ids) && body.event_type_ids.length
    ? body.event_type_ids.map(Number).filter(Number.isFinite)
    : DEFAULT_EVENTS;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const webhookUrl = `${supabaseUrl}/functions/v1/viva-webhook`;

  const results: Record<string, unknown> = { webhook_url: webhookUrl, smart_checkout: [], pos: [] };

  // Smart Checkout / ISVPaymentAPI
  try {
    const token = await getVivaAccessToken();
    const env = vivaEnv();
    for (const id of eventTypeIds) {
      const r = await registerEvent(env.api, token, id, webhookUrl);
      (results.smart_checkout as unknown[]).push({ event_type_id: id, ...r });
    }
  } catch (e) {
    results.smart_checkout_error = String((e as Error).message || e);
  }

  // POS / ISVCloudTerminalAPI
  try {
    const { token } = await getVivaPosAccessToken();
    const env = vivaPosEnv();
    for (const id of eventTypeIds) {
      const r = await registerEvent(env.api, token, id, webhookUrl);
      (results.pos as unknown[]).push({ event_type_id: id, ...r });
    }
  } catch (e) {
    results.pos_error = String((e as Error).message || e);
  }

  return json({ ok: true, results });
});
