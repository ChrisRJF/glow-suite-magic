// TEMPORARY read-only ISV transaction check. Platform owner + AAL2. Deleted after one run.
// Fixed transaction only; returns field names and fee/commission amounts, never raw payload or tokens.
// Body {mode:"eligibility"} only checks access (no Viva call), used to show the preview button.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { aalFromJwt, authorizeDemoActor } from "../_shared/isvDemoGuard.ts";

const TX = "e18737eb-cb30-4064-9bc7-595a9fd651e4";
const ORDER = "4261090033032676";
const MERCHANT = "41e4f587-c953-4b02-b3fe-8386c8d9f2ed";
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const FIN = /fee|commission|isv|interchange|amount|charge|price|cost/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const jwt = (/^Bearer\s+(.+)$/i.exec(req.headers.get("Authorization") ?? "")?.[1] ?? "").trim();
  let userId: string | null = null;
  if (jwt) userId = (await service.auth.getUser(jwt)).data?.user?.id ?? null;
  let isOwner = false;
  if (userId) {
    const { data, error } = await service.from("platform_owners").select("user_id").eq("user_id", userId).maybeSingle();
    if (error) return json(500, { error: "auth_unavailable" });
    isOwner = !!data;
  }
  const auth = authorizeDemoActor({ userId, isPlatformOwner: isOwner, aal: userId ? aalFromJwt(jwt) : null });
  if (auth !== "ok") return json(auth === "unauthenticated" ? 401 : 403, { error: auth });

  const body: any = await req.json().catch(() => ({}));
  if (body?.mode === "eligibility") return json(200, { eligible: true });

  const id = (Deno.env.get("VIVA_ISV_CLIENT_ID") ?? "").trim(), sec = (Deno.env.get("VIVA_ISV_CLIENT_SECRET") ?? "").trim();
  if (!id || !sec) return json(500, { error: "isv_credentials_missing" });
  const tok = await fetch("https://demo-accounts.vivapayments.com/connect/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${id}:${sec}`) }, body: "grant_type=client_credentials",
  });
  const tj: any = await tok.json().catch(() => ({}));
  if (!tok.ok || !tj.access_token) return json(200, { ok: false, stage: "token", http_status: tok.status });
  const res = await fetch(`https://demo-api.vivapayments.com/checkout/v2/isv/transactions/${TX}?merchantId=${MERCHANT}`, { headers: { Authorization: `Bearer ${tj.access_token}`, Accept: "application/json" } });
  const d: any = await res.json().catch(() => ({}));
  const fieldNames = Object.keys(d ?? {}).sort();
  const financial: Record<string, unknown> = {};
  for (const k of fieldNames) { const v = d[k]; if (FIN.test(k) && (typeof v === "number" || v === null || typeof v === "string")) financial[k] = v; }
  const out = {
    ok: res.ok, http_status: res.status,
    identity: { order_code_match: String(d.orderCode ?? "") === ORDER, status_id: d.statusId ?? null },
    field_names: fieldNames, financial_fields: financial,
  };
  console.log("[viva-isv-tx-check]", JSON.stringify({ http_status: res.status, n_fields: fieldNames.length }));
  return json(200, out);
});
