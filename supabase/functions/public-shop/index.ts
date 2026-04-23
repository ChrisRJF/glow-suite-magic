import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get_shop"), slug: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal("get_order"), slug: z.string().trim().min(1).max(120), order_id: z.string().uuid() }),
  z.object({
    action: z.literal("create_order"),
    slug: z.string().trim().min(1).max(120),
    customer: z.object({
      name: z.string().trim().max(120).optional().default(""),
      email: z.string().trim().email().max(255).or(z.literal("")).optional().default(""),
      phone: z.string().trim().max(40).optional().default(""),
    }).optional().default({}),
    items: z.array(z.object({ product_id: z.string().uuid(), quantity: z.number().int().min(1).max(50) })).min(1).max(20),
    method: z.enum(["ideal", "bancontact", "creditcard", "applepay", "paypal", "banktransfer"]).optional().default("ideal"),
    redirect_url: z.string().url().optional(),
  }),
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function getSalon(supabase: ReturnType<typeof createClient>, slug: string) {
  const normalized = slugify(slug);
  const cols = "id, user_id, salon_name, public_slug, whitelabel_branding, demo_mode, is_demo, webshop_enabled";
  const { data: rows, error } = await supabase.from("settings").select(cols).or(`public_slug.eq.${normalized},public_slug.eq.${slug}`).limit(1);
  if (error) throw error;
  let settings = rows?.[0];
  if (!settings) {
    const { data: fallbackRows } = await supabase.from("settings").select(cols).limit(200);
    settings = fallbackRows?.find((row: any) => slugify(row.salon_name || "") === normalized);
  }
  return settings || null;
}

async function getProducts(supabase: ReturnType<typeof createClient>, settings: any) {
  const { data, error } = await supabase
    .from("products")
    .select("id, name, description, price, stock, image_url")
    .eq("user_id", settings.user_id)
    .eq("is_demo", Boolean(settings.is_demo || settings.demo_mode))
    .eq("is_active", true)
    .eq("online_visible", true)
    .gt("stock", 0)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map((product: any) => ({ ...product, price: Number(product.price || 0), stock: Number(product.stock || 0) }));
}

function safeShopPayload(settings: any, products: any[]) {
  const branding = settings.whitelabel_branding || {};
  return {
    salon: {
      slug: settings.public_slug || slugify(settings.salon_name || "salon"),
      name: settings.salon_name || branding.salon_name || "Salon",
      logo_url: branding.logo_url || "",
      primary_color: branding.primary_color || "#7B61FF",
      secondary_color: branding.secondary_color || "#C850C0",
    },
    products,
  };
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

async function mollieFetch(path: string, accessToken: string, init?: RequestInit) {
  const response = await fetch(`https://api.mollie.com/v2${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.detail || data?.title || data?.message || "Mollie betaling kon niet worden gestart.");
  return data;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode niet toegestaan" }, 405);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const parsed = RequestSchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Ongeldige invoer", details: parsed.error.flatten().fieldErrors }, 400);

    const settings = await getSalon(supabase, parsed.data.slug);
    if (!settings) return json({ error: "Deze shop bestaat niet." }, 404);
    if (!settings.webshop_enabled) return json({ error: "Deze shop is nog niet actief." }, 403);

    if (parsed.data.action === "get_shop") return json(safeShopPayload(settings, await getProducts(supabase, settings)));

    if (parsed.data.action === "get_order") {
      const { data: order } = await supabase.from("webshop_orders").select("order_number, payment_status, status, total_amount").eq("id", parsed.data.order_id).eq("user_id", settings.user_id).maybeSingle();
      if (!order) return json({ error: "Bestelling niet gevonden." }, 404);
      return json({ order });
    }

    const data = parsed.data;
    const productIds = data.items.map((item) => item.product_id);
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, description, price, stock, image_url")
      .eq("user_id", settings.user_id)
      .eq("is_demo", Boolean(settings.is_demo || settings.demo_mode))
      .eq("is_active", true)
      .eq("online_visible", true)
      .in("id", productIds);
    if (productsError) throw productsError;

    const productMap = new Map((products || []).map((product: any) => [product.id, product]));
    const orderItems = data.items.map((item) => {
      const product: any = productMap.get(item.product_id);
      if (!product) throw new Error("Een product is niet meer beschikbaar.");
      if (Number(product.stock || 0) < item.quantity) throw new Error(`${product.name} heeft onvoldoende voorraad.`);
      const price = Number(product.price || 0);
      return { product_id: product.id, name: product.name, price, quantity: item.quantity, total: price * item.quantity };
    });
    const totalAmount = orderItems.reduce((sum, item) => sum + item.total, 0);
    if (totalAmount <= 0) return json({ error: "Bestelling heeft geen geldig bedrag." }, 400);

    const email = (data.customer.email || "").toLowerCase();
    let customerId: string | null = null;
    if (email) {
      const { data: existingCustomer } = await supabase.from("customers").select("id").eq("user_id", settings.user_id).ilike("email", email).maybeSingle();
      customerId = existingCustomer?.id || null;
      if (!customerId) {
        const { data: newCustomer } = await supabase.from("customers").insert({ user_id: settings.user_id, is_demo: Boolean(settings.is_demo || settings.demo_mode), name: data.customer.name || email, email, phone: data.customer.phone || "", notes: "Aangemaakt via webshop" }).select("id").single();
        customerId = newCustomer?.id || null;
      }
    }

    const { data: order, error: orderError } = await supabase.from("webshop_orders").insert({
      user_id: settings.user_id,
      customer_id: customerId,
      customer_name: data.customer.name || "",
      customer_email: email,
      customer_phone: data.customer.phone || "",
      items: orderItems,
      total_amount: totalAmount,
      payment_status: "open",
      status: "open",
      is_demo: Boolean(settings.is_demo || settings.demo_mode),
    }).select("*").single();
    if (orderError) throw orderError;

    if (settings.demo_mode || settings.is_demo) {
      await supabase.from("webshop_orders").update({ payment_status: "paid", status: "paid" }).eq("id", order.id);
      return json({ success: true, demo: true, order: { ...order, payment_status: "paid", status: "paid" } });
    }

    const { data: rawConnection } = await supabase.from("mollie_connections").select("*").eq("user_id", settings.user_id).eq("salon_id", settings.id).eq("is_active", true).is("disconnected_at", null).maybeSingle();
    if (!rawConnection) return json({ error: "Mollie is nog niet gekoppeld. Activeer GlowPay voordat klanten kunnen afrekenen." }, 400);
    const connection = await refreshConnection(supabase, rawConnection);
    const profile = await getWebsiteProfile(connection.mollie_access_token);
    const origin = req.headers.get("origin") || "https://glowsuite.nl";
    const redirectBase = data.redirect_url || `${origin}/shop/${settings.public_slug || slugify(settings.salon_name || "salon")}`;
    const molliePayment = await mollieFetch("/payments", connection.mollie_access_token, {
      method: "POST",
      body: JSON.stringify({
        amount: { currency: "EUR", value: totalAmount.toFixed(2) },
        description: `Bestelling ${order.order_number}`,
        redirectUrl: `${redirectBase}${redirectBase.includes("?") ? "&" : "?"}order=${order.id}`,
        webhookUrl: `${Deno.env.get("SUPABASE_URL")}/functions/v1/mollie-webhook`,
        method: data.method,
        profileId: profile.id,
        metadata: { source: "webshop", order_id: order.id, salon_id: settings.user_id, payment_type: "webshop" },
      }),
    });

    const { data: payment, error: paymentError } = await supabase.from("payments").insert({
      user_id: settings.user_id,
      customer_id: customerId,
      order_id: order.id,
      mollie_payment_id: molliePayment.id,
      amount: totalAmount,
      currency: "EUR",
      payment_type: "webshop",
      status: "pending",
      method: data.method,
      mollie_method: data.method,
      provider: "mollie",
      is_demo: false,
      metadata: { source: "webshop", order_id: order.id, profile_id: profile.id },
    }).select("id").single();
    if (paymentError) throw paymentError;

    await supabase.from("webshop_orders").update({ mollie_payment_id: molliePayment.id, payment_id: payment.id, payment_status: "open", status: "open" }).eq("id", order.id);
    return json({ success: true, order: { ...order, mollie_payment_id: molliePayment.id, payment_id: payment.id }, checkoutUrl: molliePayment._links?.checkout?.href });
  } catch (error) {
    return json({ error: (error as Error).message || "Shop kon niet worden verwerkt." }, 500);
  }
});
