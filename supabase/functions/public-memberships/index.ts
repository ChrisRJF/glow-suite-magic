import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_memberships"), slug: z.string().trim().min(1).max(120) }),
  z.object({
    action: z.literal("join_membership"),
    slug: z.string().trim().min(1).max(120),
    membership_plan_id: z.string().uuid(),
    customer: z.object({
      name: z.string().trim().min(2).max(120),
      email: z.string().trim().email().max(255),
      phone: z.string().trim().max(40).optional().default(""),
    }),
    method: z.enum(["ideal", "bancontact", "creditcard", "applepay", "paypal"]).optional().default("ideal"),
    redirect_url: z.string().url().optional(),
  }),
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function mollieFetch(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`https://api.mollie.com/v2${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || data?.title || data?.message || "Mollie betaling kon niet worden gestart.");
  return data;
}

async function refreshConnection(admin: ReturnType<typeof createClient>, connection: any) {
  if (connection.mollie_access_token_expires_at && new Date(connection.mollie_access_token_expires_at).getTime() > Date.now() + 120000) return connection;
  const clientId = Deno.env.get("MOLLIE_CLIENT_ID");
  const clientSecret = Deno.env.get("MOLLIE_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Mollie Connect is niet volledig geconfigureerd.");
  const response = await fetch("https://api.mollie.com/oauth2/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: connection.mollie_refresh_token, client_id: clientId, client_secret: clientSecret }),
  });
  const token = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Mollie account is verlopen. Koppel Mollie opnieuw.");
  const expiresAt = new Date(Date.now() + Math.max(60, Number(token.expires_in || 3600) - 120) * 1000).toISOString();
  await admin.from("mollie_connections").update({ mollie_access_token: token.access_token, mollie_refresh_token: token.refresh_token || connection.mollie_refresh_token, mollie_access_token_expires_at: expiresAt, last_sync_at: new Date().toISOString() }).eq("id", connection.id);
  return { ...connection, mollie_access_token: token.access_token, mollie_refresh_token: token.refresh_token || connection.mollie_refresh_token, mollie_access_token_expires_at: expiresAt };
}

async function getWebsiteProfile(accessToken: string) {
  try {
    const profile = await mollieFetch("/profiles/me", accessToken);
    if (profile?.id) return profile;
  } catch (_) {}
  const profiles = await mollieFetch("/profiles", accessToken);
  const list = profiles?._embedded?.profiles || [];
  const active = list.find((profile: any) => profile.status === "verified") || list.find((profile: any) => profile.status === "unverified") || list[0];
  if (!active?.id) throw new Error("Geen Mollie websiteprofiel gevonden. Maak of activeer eerst een websiteprofiel in Mollie.");
  return active;
}

async function getSalon(supabase: ReturnType<typeof createClient>, slug: string) {
  const normalized = slugify(slug);
  const cols = "id, user_id, salon_name, public_slug, whitelabel_branding, demo_mode, is_demo";
  const { data: rows, error } = await supabase.from("settings").select(cols).or(`public_slug.eq.${normalized},public_slug.eq.${slug}`).limit(1);
  if (error) throw error;
  let settings = rows?.[0];
  if (!settings) {
    const { data: fallbackRows } = await supabase.from("settings").select(cols).limit(200);
    settings = fallbackRows?.find((row: any) => slugify(row.salon_name || "") === normalized);
  }
  return settings || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode niet toegestaan" }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Ongeldige invoer", details: parsed.error.flatten().fieldErrors }, 400);

    const settings = await getSalon(supabase, parsed.data.slug);
    if (!settings) return json({ error: "Deze membershippagina bestaat niet." }, 404);

    const branding = settings.whitelabel_branding || {};
    const membershipFeatures = {
      white_label_signup: true,
      member_portal: true,
      ...(branding.membership_features || {}),
    };

    if (!membershipFeatures.white_label_signup || !membershipFeatures.member_portal) {
      return json({ error: "Deze membershippagina is nog niet actief." }, 404);
    }

    const { data: plans, error: planError } = await supabase
      .from("membership_plans")
      .select("id, name, description, price, billing_interval, benefits, included_treatments, discount_percentage, priority_booking")
      .eq("user_id", settings.user_id)
      .eq("is_demo", Boolean(settings.is_demo || settings.demo_mode))
      .eq("is_active", true)
      .order("price", { ascending: true });
    if (planError) throw planError;

    if (parsed.data.action === "get_memberships") {
      return json({ salon: { name: settings.salon_name || branding.salon_name || "Salon", primary_color: branding.primary_color || "#7B61FF", secondary_color: branding.secondary_color || "#C850C0" }, plans: plans || [] });
    }

    const data = parsed.data;
    const plan = (plans || []).find((item: any) => item.id === data.membership_plan_id);
    if (!plan) return json({ error: "Membership is niet beschikbaar." }, 404);

    const email = data.customer.email.toLowerCase();
    const { data: existingCustomer } = await supabase.from("customers").select("id").eq("user_id", settings.user_id).ilike("email", email).maybeSingle();
    let customerId = existingCustomer?.id || null;
    if (!customerId) {
      const { data: customer, error } = await supabase.from("customers").insert({ user_id: settings.user_id, is_demo: Boolean(settings.is_demo || settings.demo_mode), name: data.customer.name, email, phone: data.customer.phone || "", notes: "Aangemaakt via membership aanmelding" }).select("id").single();
      if (error) throw error;
      customerId = customer.id;
    }

    const { data: membership, error: membershipError } = await supabase.from("customer_memberships").insert({
      user_id: settings.user_id,
      customer_id: customerId,
      membership_plan_id: plan.id,
      status: settings.demo_mode || settings.is_demo ? "active" : "payment_issue",
      credits_available: Number(plan.included_treatments || 0),
      current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      last_payment_status: settings.demo_mode || settings.is_demo ? "paid" : "open",
      is_demo: Boolean(settings.is_demo || settings.demo_mode),
    }).select("*").single();
    if (membershipError) throw membershipError;

    if (settings.demo_mode || settings.is_demo) return json({ success: true, demo: true, membership });

    const { data: rawConnection } = await supabase.from("mollie_connections").select("*").eq("user_id", settings.user_id).eq("salon_id", settings.id).eq("is_active", true).is("disconnected_at", null).maybeSingle();
    if (!rawConnection) return json({ error: "Mollie is nog niet gekoppeld. De salon kan memberships pas verkopen na activatie van GlowPay." }, 400);
    const connection = await refreshConnection(supabase, rawConnection);
    const profile = await getWebsiteProfile(connection.mollie_access_token);
    const origin = req.headers.get("origin") || "https://glowsuite.nl";
    const redirectBase = data.redirect_url || `${origin}/memberships/${settings.public_slug || slugify(settings.salon_name || "salon")}`;
    const molliePayment = await mollieFetch("/payments", connection.mollie_access_token, {
      method: "POST",
      body: JSON.stringify({
        amount: { currency: "EUR", value: Number(plan.price || 0).toFixed(2) },
        description: `${plan.name} membership`,
        redirectUrl: `${redirectBase}${redirectBase.includes("?") ? "&" : "?"}membership=${membership.id}`,
        webhookUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mollie-webhook`,
        method: data.method,
        sequenceType: "first",
        profileId: profile.id,
        metadata: { source: "membership", membership_id: membership.id, customer_id: customerId, salon_id: settings.user_id, payment_type: "membership" },
      }),
    });

    const { error: paymentError } = await supabase.from("payments").insert({
      user_id: settings.user_id,
      customer_id: customerId,
      membership_id: membership.id,
      mollie_payment_id: molliePayment.id,
      amount: Number(plan.price || 0),
      currency: "EUR",
      payment_type: "membership",
      status: "pending",
      method: data.method,
      mollie_method: data.method,
      provider: "mollie",
      is_demo: false,
      metadata: { source: "membership", membership_id: membership.id, profile_id: profile.id },
    });
    if (paymentError) throw paymentError;

    return json({ success: true, membership, checkoutUrl: molliePayment._links?.checkout?.href });
  } catch (error) {
    return json({ error: (error as Error).message || "Membership kon niet worden verwerkt." }, 500);
  }
});
