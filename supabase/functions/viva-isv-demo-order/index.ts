// TEMPORARY ISV demo order route. Platform owner + MFA (aal2) only.
// Order creation is blocked unless VIVA_ISV_DEMO_ENABLED === "true" (unset = off).
// Merchant, amount and fee are server-side; browser input is ignored.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { aalFromJwt, authorizeDemoActor, idempotencyDecision, ISV_DEMO_AMOUNT_CENTS, ISV_DEMO_KEY, orderSwitchOn } from "../_shared/isvDemoGuard.ts";
import { isvCredentials, prepareOnlineIsvOrder } from "../_shared/vivaIsvPrepared.ts";
import { assertIsvOrderTarget, auditOrderBody } from "../_shared/isvDemoReadiness.ts";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization") ?? "");
  const jwt = m?.[1]?.trim() ?? "";
  let userId: string | null = null;
  if (jwt) {
    const { data } = await service.auth.getUser(jwt);
    userId = data?.user?.id ?? null;
  }
  let isOwner = false;
  if (userId) {
    const { data, error } = await service.from("platform_owners").select("user_id").eq("user_id", userId).maybeSingle();
    if (error) return json(500, { error: "auth_unavailable" });
    isOwner = !!data;
  }
  const auth = authorizeDemoActor({ userId, isPlatformOwner: isOwner, aal: userId ? aalFromJwt(jwt) : null });
  if (auth !== "ok") return json(auth === "unauthenticated" ? 401 : 403, { error: auth });

  // Switch BEFORE any write or Viva call.
  const env = Deno.env.toObject();
  if (!orderSwitchOn(env)) return json(423, { error: "isv_demo_disabled" });
  if (!isvCredentials(env)) return json(500, { error: "isv_credentials_missing" });

  // Idempotency: one demo payment per owner.
  const { data: prevRows, error: prevErr } = await service.from("payments")
    .select("id,status,metadata").eq("user_id", userId).eq("is_demo", true)
    .eq("metadata->>isv_demo_key", ISV_DEMO_KEY).limit(1);
  if (prevErr) return json(500, { error: "lookup_failed" });
  const prev = prevRows?.[0] ?? null;
  const dec = idempotencyDecision(prev ? { id: prev.id, status: prev.status, orderCode: (prev.metadata as any)?.viva_order_code ?? null } : null);
  if (dec === "return_existing") return json(200, { reused: true, payment_id: prev!.id, order_code: (prev!.metadata as any).viva_order_code });
  if (dec === "stuck_needs_review") return json(409, { error: "previous_attempt_needs_review", payment_id: prev!.id });

  // Existing demo merchant from server secrets only.
  const merchant = {
    is_demo: true, onboarding_status: "active", terminals_enabled: false,
    viva_merchant_id: (env.VIVA_MERCHANT_ID ?? "").trim() || null,
    viva_source_code: (env.VIVA_SOURCE_CODE ?? "").trim() || null,
  };
  const prep = prepareOnlineIsvOrder({ env, merchant, amountCents: ISV_DEMO_AMOUNT_CENTS, description: "GlowSuite ISV demo" });
  if (!prep.ok) return json(400, { error: prep.error });
  if (assertIsvOrderTarget(prep.url, prep.query) !== "ok" || prep.body.isvAmount !== 35 || prep.body.amount !== 100) {
    return json(500, { error: "order_shape_invalid" });
  }

  // 1. Payment row first (pending, demo).
  const { data: pay, error: payErr } = await service.from("payments").insert({
    user_id: userId, amount: 1, currency: "EUR", status: "pending", provider: "viva", is_demo: true,
    payment_type: "isv_demo", viva_merchant_id: merchant.viva_merchant_id, viva_source_code: merchant.viva_source_code,
    metadata: { isv_demo_key: ISV_DEMO_KEY, channel: "online" },
  }).select("id").single();
  if (payErr || !pay) return json(500, { error: "payment_insert_failed" });

  // 2. Expected fee only in service-role storage (also the trusted ISV marker for the webhook).
  const { data: rec, error: recErr } = await service.rpc("record_platform_commission", {
    _payment_id: pay.id, _kind: "expected", _amount_cents: prep.feeCents, _source: "isv_demo_route", _provider_reference: "",
  });
  if (recErr || !["inserted", "duplicate"].includes(String(rec))) {
    await service.from("payments").update({ status: "failed", failure_reason: "expected_fee_not_recorded" }).eq("id", pay.id);
    return json(500, { error: "expected_fee_failed" });
  }

  // 3. Viva ISV order (demo only).
  const creds = isvCredentials(env)!;
  let httpStatus: number | null = null;
  let orderCode: string | null = null;
  try {
    const tok = await fetch("https://demo-accounts.vivapayments.com/connect/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${creds.clientId}:${creds.clientSecret}`) },
      body: "grant_type=client_credentials",
    });
    const tokJson = await tok.json().catch(() => ({}));
    if (!tok.ok || !tokJson.access_token) {
      httpStatus = tok.status;
    } else {
      const res = await fetch(`https://demo-api.vivapayments.com${prep.url}?merchantId=${encodeURIComponent(prep.query!.merchantId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokJson.access_token}` },
        body: JSON.stringify(prep.body),
      });
      httpStatus = res.status;
      const out = await res.json().catch(() => ({}));
      if (res.ok && out?.orderCode) orderCode = String(out.orderCode);
    }
  } catch { /* httpStatus stays null */ }

  console.log("[viva-isv-demo-order]", JSON.stringify({ endpoint: "isv_online_order", ...auditOrderBody(prep.body), http_status: httpStatus, order_code: orderCode }));

  if (!orderCode) {
    await service.from("payments").update({ status: "failed", failure_reason: `isv_order_failed_${httpStatus ?? "network"}` }).eq("id", pay.id);
    return json(502, { error: "order_failed", http_status: httpStatus });
  }
  await service.from("payments").update({ checkout_reference: orderCode, metadata: { isv_demo_key: ISV_DEMO_KEY, channel: "online", viva_order_code: orderCode } }).eq("id", pay.id);
  return json(200, { payment_id: pay.id, order_code: orderCode, checkout_url: `https://demo.vivapayments.com/web/checkout?ref=${orderCode}` });
});
