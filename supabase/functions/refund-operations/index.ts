import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MOLLIE_API = "https://api.mollie.com/v2";
const REASONS = ["Cancelled appointment", "Duplicate payment", "Customer complaint", "Staff issue", "Booking error", "Abonnement opzegging", "Goodwill gesture", "Other"];

const BodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create_request"), payment_id: z.string().uuid(), amount: z.number().positive(), reason: z.enum(REASONS as [string, ...string[]]), custom_reason: z.string().max(160).optional(), internal_note: z.string().max(600).optional(), notify_customer: z.boolean().default(false) }),
  z.object({ action: z.literal("approve"), refund_request_id: z.string().uuid(), note: z.string().max(300).optional() }),
  z.object({ action: z.literal("execute"), refund_request_id: z.string().uuid() }),
  z.object({ action: z.literal("sync"), refund_request_id: z.string().uuid() }),
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function exchangeToken(body: Record<string, string>) {
  const clientId = Deno.env.get("MOLLIE_CLIENT_ID");
  const clientSecret = Deno.env.get("MOLLIE_CLIENT_SECRET");
  if (!clientId) throw new Error("Mollie client ID ontbreekt.");
  if (!clientSecret) throw new Error("Mollie client secret ontbreekt.");
  const response = await fetch("https://api.mollie.com/oauth2/tokens", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Mollie token kon niet worden vernieuwd.");
  return data;
}

async function refreshConnection(admin: ReturnType<typeof createClient>, connection: any) {
  if (connection.mollie_access_token_expires_at && new Date(connection.mollie_access_token_expires_at).getTime() > Date.now() + 120000) return connection;
  const token = await exchangeToken({ grant_type: "refresh_token", refresh_token: connection.mollie_refresh_token });
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in || 3600) - 120) * 1000).toISOString();
  await admin.from("mollie_connections").update({ mollie_access_token: token.access_token, mollie_refresh_token: token.refresh_token || connection.mollie_refresh_token, mollie_access_token_expires_at: expiresAt, last_sync_at: new Date().toISOString() }).eq("id", connection.id);
  return { ...connection, mollie_access_token: token.access_token, mollie_refresh_token: token.refresh_token || connection.mollie_refresh_token, mollie_access_token_expires_at: expiresAt };
}

async function mollieFetch(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${MOLLIE_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.detail || data?.title || data?.error?.message || JSON.stringify(data);
    throw new Error(`Mollie refund mislukt (${response.status}): ${message}`);
  }
  return data;
}

async function rolesFor(admin: ReturnType<typeof createClient>, userId: string) {
  const { data } = await admin.from("user_roles").select("role").eq("user_id", userId);
  return (data || []).map((row: any) => row.role as string);
}

function hasAny(roles: string[], allowed: string[]) {
  return roles.some((role) => allowed.includes(role));
}

async function latestSettings(admin: ReturnType<typeof createClient>, userId: string) {
  const { data, error } = await admin.from("settings").select("id,salon_name,is_demo,demo_mode,mollie_mode,whitelabel_branding").eq("user_id", userId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Saloninstellingen ontbreken.");
  return data as any;
}

function refundSettings(settings: any) {
  const source = settings?.whitelabel_branding?.refund_settings || {};
  return {
    manager_max_refund: Number(source.manager_max_refund ?? 100),
    require_note_mandatory: Boolean(source.require_note_mandatory ?? true),
    require_second_approval_amount: Number(source.require_second_approval_amount ?? 100),
  };
}

async function logEvent(admin: ReturnType<typeof createClient>, data: Record<string, unknown>) {
  await admin.from("refund_events").insert(data);
  await admin.from("audit_logs").insert({ user_id: data.user_id, actor_user_id: data.actor_user_id, target_type: "refund", target_id: String(data.refund_request_id || data.payment_id || ""), action: String(data.event_type), details: data.metadata || {}, is_demo: data.is_demo || false }).catch(() => null);
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
    if (!parsed.success) return json({ error: "Ongeldige refund-invoer", details: parsed.error.flatten().fieldErrors }, 400);

    const roles = await rolesFor(admin, user.id);
    const canRequest = hasAny(roles, ["eigenaar", "manager", "admin"]);
    const canExecute = hasAny(roles, ["eigenaar", "admin"]);
    if (!canRequest) return json({ error: "Je hebt geen refund-rechten." }, 403);

    const settings = await latestSettings(admin, user.id);
    const isDemo = Boolean(settings.is_demo || settings.demo_mode);
    if (isDemo) return json({ error: "Refunds uitvoeren is alleen beschikbaar in live modus." }, 403);
    const policy = refundSettings(settings);

    const ip = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    if (parsed.data.action === "create_request") {
      if (policy.require_note_mandatory && !parsed.data.internal_note?.trim()) return json({ error: "Interne notitie is verplicht volgens refundbeleid." }, 400);
      const { data: payment, error: paymentError } = await admin.from("payments").select("*").eq("id", parsed.data.payment_id).eq("user_id", user.id).maybeSingle();
      if (paymentError) throw paymentError;
      if (!payment) return json({ error: "Betaling niet gevonden." }, 404);
      if (payment.is_demo) return json({ error: "Demo-betalingen kunnen niet live worden terugbetaald." }, 400);
      if (payment.status !== "paid") return json({ error: "Alleen betaalde betalingen kunnen worden terugbetaald." }, 400);
      if (!payment.mollie_payment_id || payment.provider !== "mollie") return json({ error: "Alleen live Mollie-betalingen zijn refundbaar." }, 400);
      if (payment.currency !== "EUR") return json({ error: "Valuta komt niet overeen met de refund-flow." }, 400);
      if (roles.includes("manager") && !canExecute && parsed.data.amount > policy.manager_max_refund) return json({ error: `Managers kunnen maximaal €${policy.manager_max_refund} aanvragen.` }, 403);

      const { data: activeRequests } = await admin.from("refund_requests").select("id,amount,status").eq("payment_id", payment.id).in("status", ["requested", "needs_approval", "approved", "queued", "pending", "processing"]);
      if ((activeRequests || []).length > 0) return json({ error: "Er staat al een actieve refund voor deze betaling open." }, 409);
      const remaining = Number(payment.amount || 0) - Number(payment.refunded_amount || 0);
      if (parsed.data.amount > remaining + 0.0001) return json({ error: "Refundbedrag is hoger dan het resterende refundbare bedrag." }, 400);

      const needsApproval = !canExecute || parsed.data.amount > policy.require_second_approval_amount;
      const status = needsApproval ? "needs_approval" : "approved";
      const { data: refundRequest, error } = await admin.from("refund_requests").insert({
        user_id: user.id,
        payment_id: payment.id,
        customer_id: payment.customer_id,
        appointment_id: payment.appointment_id,
        amount: parsed.data.amount,
        currency: payment.currency,
        reason: parsed.data.reason,
        custom_reason: parsed.data.custom_reason || null,
        internal_note: parsed.data.internal_note || null,
        notify_customer: parsed.data.notify_customer,
        status,
        requested_by: user.id,
        approved_by: status === "approved" ? user.id : null,
        approved_at: status === "approved" ? new Date().toISOString() : null,
        is_demo: false,
        metadata: { source: "refund_center", remaining_before: remaining },
      }).select("*").single();
      if (error) throw error;
      if (status === "approved") await admin.from("refund_approvals").insert({ user_id: user.id, refund_request_id: refundRequest.id, approver_user_id: user.id, approval_level: 1, status: "approved", is_demo: false });
      await logEvent(admin, { user_id: user.id, refund_request_id: refundRequest.id, payment_id: payment.id, actor_user_id: user.id, event_type: "refund_requested", amount: parsed.data.amount, reason: parsed.data.reason, notes: parsed.data.internal_note || null, ip_address: ip, user_agent: userAgent, is_demo: false, metadata: { status } });
      return json({ success: true, refund_request: refundRequest });
    }

    const { data: requestRow, error: requestError } = await admin.from("refund_requests").select("*").eq("id", parsed.data.refund_request_id).eq("user_id", user.id).maybeSingle();
    if (requestError) throw requestError;
    if (!requestRow) return json({ error: "Refundaanvraag niet gevonden." }, 404);

    if (parsed.data.action === "approve") {
      if (!canExecute) return json({ error: "Alleen eigenaren en admins kunnen refunds goedkeuren." }, 403);
      if (!["requested", "needs_approval"].includes(requestRow.status)) return json({ error: "Deze refund kan niet meer worden goedgekeurd." }, 400);
      await admin.from("refund_approvals").insert({ user_id: user.id, refund_request_id: requestRow.id, approver_user_id: user.id, approval_level: 1, status: "approved", note: parsed.data.note || null, is_demo: false });
      const { data: updated } = await admin.from("refund_requests").update({ status: "approved", approved_by: user.id, approved_at: new Date().toISOString() }).eq("id", requestRow.id).select("*").single();
      await logEvent(admin, { user_id: user.id, refund_request_id: requestRow.id, payment_id: requestRow.payment_id, actor_user_id: user.id, event_type: "refund_approved", amount: requestRow.amount, notes: parsed.data.note || null, ip_address: ip, user_agent: userAgent, is_demo: false, metadata: {} });
      return json({ success: true, refund_request: updated });
    }

    if (parsed.data.action === "sync") {
      if (!requestRow.mollie_refund_id) return json({ error: "Deze refund heeft nog geen Mollie refund ID." }, 400);
      const { data: connection } = await admin.from("mollie_connections").select("*").eq("user_id", user.id).eq("salon_id", settings.id).eq("is_active", true).is("disconnected_at", null).maybeSingle();
      if (!connection) return json({ error: "Mollie account is niet verbonden." }, 400);
      const activeConnection = await refreshConnection(admin, connection);
      const refund = await mollieFetch(`/payments/${requestRow.metadata?.mollie_payment_id || ""}/refunds/${requestRow.mollie_refund_id}`, activeConnection.mollie_access_token, { method: "GET" });
      const mapped = refund.status || requestRow.status;
      await admin.from("refund_requests").update({ status: mapped, processed_at: ["refunded", "failed", "cancelled"].includes(mapped) ? new Date().toISOString() : requestRow.processed_at, metadata: { ...(requestRow.metadata || {}), mollie_refund: refund } }).eq("id", requestRow.id);
      await logEvent(admin, { user_id: user.id, refund_request_id: requestRow.id, payment_id: requestRow.payment_id, actor_user_id: user.id, event_type: "refund_synced", amount: requestRow.amount, ip_address: ip, user_agent: userAgent, is_demo: false, metadata: { status: mapped } });
      return json({ success: true, refund });
    }

    if (parsed.data.action === "execute") {
      if (!canExecute) return json({ error: "Alleen eigenaren en admins kunnen refunds uitvoeren." }, 403);
      if (!["approved", "requested"].includes(requestRow.status)) return json({ error: "Deze refund is niet klaar voor uitvoering." }, 400);
      const { data: payment, error: paymentError } = await admin.from("payments").select("*").eq("id", requestRow.payment_id).eq("user_id", user.id).maybeSingle();
      if (paymentError) throw paymentError;
      if (!payment || payment.status !== "paid" || payment.is_demo || !payment.mollie_payment_id) return json({ error: "Betaling is niet refundbaar." }, 400);
      const remaining = Number(payment.amount || 0) - Number(payment.refunded_amount || 0);
      if (Number(requestRow.amount) > remaining + 0.0001) return json({ error: "Deze refund overschrijdt het resterende bedrag." }, 400);

      await admin.from("refund_requests").update({ status: "processing", executed_by: user.id, executed_at: new Date().toISOString() }).eq("id", requestRow.id).in("status", ["approved", "requested"]);
      const { data: connection } = await admin.from("mollie_connections").select("*").eq("user_id", user.id).eq("salon_id", settings.id).eq("is_active", true).is("disconnected_at", null).maybeSingle();
      if (!connection) return json({ error: "Mollie account is niet verbonden." }, 400);
      const activeConnection = await refreshConnection(admin, connection);
      const description = requestRow.custom_reason || requestRow.reason || "GlowSuite refund";
      const refund = await mollieFetch(`/payments/${payment.mollie_payment_id}/refunds`, activeConnection.mollie_access_token, { method: "POST", headers: { "Idempotency-Key": requestRow.idempotency_key }, body: JSON.stringify({ amount: { currency: requestRow.currency, value: Number(requestRow.amount).toFixed(2) }, description }) });
      const nextRefunded = Number(payment.refunded_amount || 0) + Number(requestRow.amount);
      const fullyRefunded = nextRefunded >= Number(payment.amount || 0) - 0.0001;
      await admin.from("payment_refunds").insert({ user_id: user.id, payment_id: payment.id, mollie_refund_id: refund.id, amount: requestRow.amount, currency: requestRow.currency, status: refund.status || "queued", reason: description, is_demo: false, metadata: { refund_request_id: requestRow.id, mollie_refund: refund } });
      await admin.from("payments").update({ status: fullyRefunded ? "refunded" : "paid", refunded_amount: nextRefunded, last_status_sync_at: new Date().toISOString() }).eq("id", payment.id);
      const { data: updated } = await admin.from("refund_requests").update({ status: refund.status || "queued", mollie_refund_id: refund.id, processed_at: ["refunded", "failed", "cancelled"].includes(refund.status) ? new Date().toISOString() : null, metadata: { ...(requestRow.metadata || {}), mollie_payment_id: payment.mollie_payment_id, mollie_refund: refund } }).eq("id", requestRow.id).select("*").single();
      await logEvent(admin, { user_id: user.id, refund_request_id: requestRow.id, payment_id: payment.id, actor_user_id: user.id, event_type: "refund_executed", amount: requestRow.amount, reason: description, notes: requestRow.internal_note, ip_address: ip, user_agent: userAgent, is_demo: false, metadata: { mollie_refund_id: refund.id, status: refund.status } });
      if (requestRow.notify_customer) await logEvent(admin, { user_id: user.id, refund_request_id: requestRow.id, payment_id: payment.id, actor_user_id: user.id, event_type: "refund_customer_notification_requested", amount: requestRow.amount, reason: description, is_demo: false, metadata: { template: "refund_initiated" } });
      return json({ success: true, refund_request: updated, refund });
    }

    return json({ error: "Onbekende refund-actie" }, 400);
  } catch (error) {
    console.error("refund-operations error", { error: (error as Error).message });
    return json({ error: (error as Error).message || "Refund actie kon niet worden uitgevoerd." }, 500);
  }
});
