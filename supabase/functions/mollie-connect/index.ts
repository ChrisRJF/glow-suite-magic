import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REDIRECT_URI = "https://glowsuite.nl/integrations/mollie/callback";
const MOLLIE_API = "https://api.mollie.com/v2";
const MOLLIE_AUTH = "https://www.mollie.com/oauth2/authorize";
const ALLOWED_METHODS = ["ideal", "bancontact", "creditcard", "applepay", "paypal", "banktransfer"];
const METHOD_LABELS: Record<string, string> = {
  ideal: "iDEAL",
  bancontact: "Bancontact",
  creditcard: "Creditcard",
  applepay: "Apple Pay",
  paypal: "PayPal",
  banktransfer: "SEPA overboeking",
};

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }),
  z.object({ action: z.literal("start"), redirect_to: z.string().optional() }),
  z.object({ action: z.literal("callback"), code: z.string().min(8), state: z.string().min(16) }),
  z.object({ action: z.literal("sync_methods") }),
  z.object({ action: z.literal("disconnect") }),
  z.object({ action: z.literal("refund"), payment_id: z.string().uuid(), reason: z.string().max(300).optional() }),
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function addSeconds(seconds: number) {
  return new Date(Date.now() + Math.max(60, seconds - 120) * 1000).toISOString();
}

async function requireOwner(admin: ReturnType<typeof createClient>, userId: string) {
  const { data } = await admin.from("user_roles").select("role").eq("user_id", userId);
  const allowed = (data || []).some((row: any) => ["eigenaar", "manager", "admin"].includes(row.role));
  if (!allowed) throw new Error("Alleen eigenaren en beheerders kunnen Mollie beheren.");
}

async function getSettings(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin
    .from("settings")
    .select("id,user_id,salon_name,is_demo,demo_mode,mollie_mode")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Saloninstellingen ontbreken.");
  return data as any;
}

async function mollieFetch(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${MOLLIE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Mollie aanvraag mislukt (${response.status}).`);
  return data;
}

async function exchangeToken(body: Record<string, string>) {
  const clientId = Deno.env.get("MOLLIE_CLIENT_ID");
  const clientSecret = Deno.env.get("MOLLIE_CLIENT_SECRET");
  if (!clientId) throw new Error("Mollie client ID ontbreekt.");
  if (!clientSecret) throw new Error("Mollie client secret ontbreekt.");
  const response = await fetch("https://api.mollie.com/oauth2/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("De Mollie koppeling kon niet worden afgerond. Probeer opnieuw.");
  return data;
}

async function syncConnectionDetails(accessToken: string) {
  const organization = await mollieFetch("/organizations/me", accessToken).catch(() => null);
  const methodsData = await mollieFetch("/methods?resource=payments&sequenceType=oneoff&locale=nl_NL", accessToken).catch(() => ({ _embedded: { methods: [] } }));
  const methods = ((methodsData as any)?._embedded?.methods || [])
    .filter((method: any) => ALLOWED_METHODS.includes(method.id) && method.status !== "disabled")
    .map((method: any) => ({ id: method.id, description: method.description || METHOD_LABELS[method.id] || method.id, status: method.status || "enabled" }));
  return { organization, methods };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode niet toegestaan" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";
    const client = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return json({ error: "Je sessie is verlopen. Log opnieuw in." }, 401);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return json({ error: "Ongeldige invoer", details: parsed.error.flatten().fieldErrors }, 400);

    const settings = await getSettings(admin, user.id);
    const isDemo = Boolean(settings.is_demo || settings.demo_mode);

    if (parsed.data.action === "status") {
      const { data: connection } = await admin
        .from("mollie_connections")
        .select("id,account_name,organization_name,mollie_organization_id,mollie_mode,onboarding_status,webhook_status,supported_methods,last_sync_at,connected_at,disconnected_at,is_active,is_demo")
        .eq("user_id", user.id)
        .eq("salon_id", settings.id)
        .eq("is_active", true)
        .is("disconnected_at", null)
        .maybeSingle();
      return json({ connected: Boolean(connection), demo: isDemo, connection });
    }

    await requireOwner(admin, user.id);

    if (isDemo && parsed.data.action !== "status") {
      return json({ error: "Deze actie gebruikt echte Mollie-koppelingen en is alleen beschikbaar in live modus." }, 403);
    }

    if (parsed.data.action === "start") {
      const clientId = Deno.env.get("MOLLIE_CLIENT_ID");
      if (!clientId) return json({ error: "Mollie client ID ontbreekt." }, 500);
      const state = crypto.randomUUID() + crypto.randomUUID().replaceAll("-", "");
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      await admin.from("mollie_oauth_states").insert({ user_id: user.id, salon_id: settings.id, state, redirect_to: parsed.data.redirect_to || "/instellingen?tab=integraties", is_demo: false, expires_at: expiresAt });
      const scopes = [
        "profiles.read",
        "payments.read",
        "payments.write",
        "refunds.read",
        "refunds.write",
        "organizations.read",
      ].join(" ");
      const params = new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT_URI, response_type: "code", state, scope: scopes });
      return json({ authorizationUrl: `${MOLLIE_AUTH}?${params.toString()}` });
    }

    if (parsed.data.action === "callback") {
      const { data: oauthState, error: stateError } = await admin
        .from("mollie_oauth_states")
        .select("*")
        .eq("state", parsed.data.state)
        .eq("user_id", user.id)
        .is("consumed_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (stateError) throw stateError;
      if (!oauthState) return json({ error: "Ongeldige of verlopen Mollie-koppelcode." }, 400);

      const token = await exchangeToken({ grant_type: "authorization_code", code: parsed.data.code, redirect_uri: REDIRECT_URI });
      const { organization, methods } = await syncConnectionDetails(token.access_token);
      await admin.from("mollie_connections").update({ is_active: false, disconnected_at: new Date().toISOString() }).eq("salon_id", settings.id).eq("is_active", true);
      const { data: connection, error: insertError } = await admin.from("mollie_connections").insert({
        user_id: user.id,
        salon_id: settings.id,
        mollie_organization_id: organization?.id || null,
        mollie_access_token: token.access_token,
        mollie_refresh_token: token.refresh_token,
        mollie_access_token_expires_at: addSeconds(Number(token.expires_in || 3600)),
        mollie_mode: settings.mollie_mode || "live",
        account_name: organization?.name || organization?.email || "Mollie account",
        organization_name: organization?.name || null,
        onboarding_status: organization?.status || "connected",
        webhook_status: "configured",
        supported_methods: methods,
        last_sync_at: new Date().toISOString(),
        is_active: true,
        is_demo: false,
      }).select("id,account_name,organization_name,mollie_mode,onboarding_status,webhook_status,supported_methods,last_sync_at,connected_at,is_active").single();
      if (insertError) throw insertError;
      await admin.from("mollie_oauth_states").update({ consumed_at: new Date().toISOString() }).eq("id", oauthState.id);
      await admin.from("audit_logs").insert({ user_id: user.id, actor_user_id: user.id, action: "mollie_connected", target_type: "mollie_connection", target_id: connection.id, details: { organization_id: organization?.id }, is_demo: false });
      return json({ success: true, connection });
    }

    if (parsed.data.action === "sync_methods") {
      const { data: connection, error: connectionError } = await admin
        .from("mollie_connections")
        .select("id,mollie_access_token")
        .eq("user_id", user.id)
        .eq("salon_id", settings.id)
        .eq("is_active", true)
        .is("disconnected_at", null)
        .maybeSingle();
      if (connectionError) throw connectionError;
      if (!connection) return json({ error: "Mollie account is niet verbonden." }, 400);
      const { organization, methods } = await syncConnectionDetails((connection as any).mollie_access_token);
      const { data: updated, error: updateError } = await admin
        .from("mollie_connections")
        .update({
          mollie_organization_id: organization?.id || null,
          account_name: organization?.name || organization?.email || "Mollie account",
          organization_name: organization?.name || null,
          onboarding_status: organization?.status || "connected",
          supported_methods: methods,
          last_sync_at: new Date().toISOString(),
        })
        .eq("id", (connection as any).id)
        .select("id,account_name,organization_name,mollie_mode,onboarding_status,webhook_status,supported_methods,last_sync_at,connected_at,is_active")
        .single();
      if (updateError) throw updateError;
      await admin.from("audit_logs").insert({ user_id: user.id, actor_user_id: user.id, action: "mollie_methods_synced", target_type: "mollie_connection", target_id: (connection as any).id, details: { methods: methods.map((method: any) => method.id) }, is_demo: false });
      return json({ success: true, connection: updated });
    }

    if (parsed.data.action === "disconnect") {
      await admin.from("mollie_connections").update({ is_active: false, disconnected_at: new Date().toISOString(), webhook_status: "disabled" }).eq("user_id", user.id).eq("salon_id", settings.id).eq("is_active", true);
      await admin.from("audit_logs").insert({ user_id: user.id, actor_user_id: user.id, action: "mollie_disconnected", target_type: "mollie_connection", details: {}, is_demo: false });
      return json({ success: true });
    }

    if (parsed.data.action === "refund") {
      const { data: payment, error: paymentError } = await admin.from("payments").select("*").eq("id", parsed.data.payment_id).eq("user_id", user.id).maybeSingle();
      if (paymentError) throw paymentError;
      if (!payment) return json({ error: "Betaling niet gevonden." }, 404);
      if (payment.is_demo) {
        await admin.from("payment_refunds").insert({ user_id: user.id, payment_id: payment.id, amount: payment.amount, status: "refunded", reason: parsed.data.reason || "Demo refund", is_demo: true });
        await admin.from("payments").update({ status: "refunded", refunded_amount: payment.amount }).eq("id", payment.id);
        return json({ success: true, demo: true });
      }
      if (payment.status !== "paid") return json({ error: "Alleen betaalde betalingen kunnen worden terugbetaald." }, 400);
      const { data: connection } = await admin.from("mollie_connections").select("*").eq("user_id", user.id).eq("salon_id", settings.id).eq("is_active", true).is("disconnected_at", null).maybeSingle();
      if (!connection) return json({ error: "Mollie account is niet verbonden." }, 400);
      const refund = await mollieFetch(`/payments/${payment.mollie_payment_id}/refunds`, connection.mollie_access_token, {
        method: "POST",
        body: JSON.stringify({ amount: { currency: "EUR", value: Number(payment.amount).toFixed(2) }, description: parsed.data.reason || "GlowSuite terugbetaling" }),
      });
      await admin.from("payment_refunds").insert({ user_id: user.id, payment_id: payment.id, mollie_refund_id: refund.id, amount: payment.amount, status: refund.status || "queued", reason: parsed.data.reason || null, is_demo: false, metadata: refund });
      await admin.from("payments").update({ status: "refunded", refunded_amount: payment.amount, last_status_sync_at: new Date().toISOString() }).eq("id", payment.id);
      return json({ success: true, refund });
    }

    return json({ error: "Onbekende actie" }, 400);
  } catch (error) {
    return json({ error: (error as Error).message || "Mollie actie kon niet worden uitgevoerd." }, 500);
  }
});
