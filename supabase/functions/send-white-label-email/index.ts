import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const SENDER_DOMAIN = "email.glowsuite.nl";
const RESERVED_LOCAL_PARTS = new Set(["admin", "administrator", "abuse", "billing", "bookings", "contact", "hello", "help", "info", "mail", "noreply", "postmaster", "security", "support"]);

const TemplateSchema = z.enum([
  "booking_confirmation",
  "payment_receipt",
  "appointment_reminder",
  "booking_cancellation",
  "membership_notification",
  "review_request",
]);

const BodySchema = z.object({
  user_id: z.string().uuid(),
  salon_slug: z.string().trim().min(1).max(80).optional(),
  salon_name: z.string().trim().min(1).max(120).optional(),
  recipient_email: z.string().trim().email().max(255),
  recipient_name: z.string().trim().max(120).optional().default(""),
  template_key: TemplateSchema,
  template_data: z.record(z.unknown()).optional().default({}),
  idempotency_key: z.string().trim().min(8).max(180),
  preview_only: z.boolean().optional().default(false),
});

type TemplateKey = z.infer<typeof TemplateSchema>;

type TemplateResult = { subject: string; preview: string; html: string; text: string };
type Action = { label: string; url?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slugify(value: string) {
  const slug = value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "").slice(0, 48);
  return slug || "salon";
}

function uniqueSalonSlug(args: { requested?: string; publicSlug?: string | null; salonName: string; userId: string }) {
  const hasStableSlug = Boolean(args.requested || args.publicSlug);
  const base = slugify(args.requested || args.publicSlug || args.salonName);
  const safeBase = RESERVED_LOCAL_PARTS.has(base) ? `salon${base}` : base;
  if (hasStableSlug) return safeBase.slice(0, 60);
  return `${safeBase.slice(0, 48)}${args.userId.replace(/-/g, "").slice(0, 8)}`.slice(0, 60);
}

function validReplyTo(value: unknown) {
  const email = String(value || "").trim().toLowerCase();
  return z.string().email().safeParse(email).success ? email : undefined;
}

function formatEuro(value: unknown) {
  const amount = Number(value || 0);
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(amount);
}

function nlDate(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function hexColor(value: unknown, fallback: string) {
  const color = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : fallback;
}

function firstFilled(...values: unknown[]) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
}

function nlDateShort(value: unknown) {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

function absoluteUrl(value: unknown, fallbackPath: string, baseUrl: string) {
  const raw = String(value ?? "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw && raw !== "#" ? raw : fallbackPath;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function shell(args: { salonName: string; title: string; intro: string; body: string; primaryAction?: Action; secondaryAction?: Action; logoUrl?: string; accent?: string; secondary?: string }) {
  const accent = hexColor(args.accent, "#7B61FF");
  const secondary = hexColor(args.secondary, "#C850C0");
  const logo = args.logoUrl ? `<img src="${escapeHtml(args.logoUrl)}" width="56" height="56" alt="${escapeHtml(args.salonName)}" style="border-radius:16px;display:block;margin:0 auto 18px;object-fit:cover;border:1px solid #F1EEF7;" />` : `<div style="width:56px;height:56px;border-radius:16px;margin:0 auto 18px;background:${accent};color:#ffffff;text-align:center;line-height:56px;font-size:20px;font-weight:800;">${escapeHtml(args.salonName.slice(0, 1).toUpperCase())}</div>`;
  const primaryCta = args.primaryAction?.url ? `<a href="${escapeHtml(args.primaryAction.url)}" style="display:block;background:${accent};color:#ffffff;text-decoration:none;border-radius:14px;padding:15px 18px;font-size:15px;font-weight:800;text-align:center;margin:18px 0 10px;">${escapeHtml(args.primaryAction.label)}</a>` : "";
  const secondaryCta = args.secondaryAction?.url ? `<a href="${escapeHtml(args.secondaryAction.url)}" style="display:block;background:#ffffff;color:${secondary};text-decoration:none;border:1px solid #E9DFF7;border-radius:14px;padding:13px 18px;font-size:14px;font-weight:750;text-align:center;margin:0 0 8px;">${escapeHtml(args.secondaryAction.label)}</a>` : "";
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(args.title)}</title></head><body style="margin:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;-webkit-font-smoothing:antialiased;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(args.intro)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;"><tr><td align="center" style="padding:22px 12px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:584px;border:1px solid #EEE7F8;border-radius:24px;overflow:hidden;background:#ffffff;"><tr><td style="padding:30px 24px 18px;text-align:center;background:linear-gradient(180deg,#FFFFFF 0%,#FCFAFF 100%);">${logo}<p style="margin:0 0 9px;color:${accent};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(args.salonName)}</p><h1 style="margin:0;color:#111827;font-size:26px;line-height:1.16;font-weight:800;letter-spacing:0;">${escapeHtml(args.title)}</h1><p style="margin:14px auto 0;color:#5F6673;font-size:16px;line-height:1.62;max-width:480px;">${escapeHtml(args.intro)}</p></td></tr><tr><td style="padding:8px 24px 30px;">${args.body}${primaryCta}${secondaryCta}<hr style="border:none;border-top:1px solid #F1EEF7;margin:26px 0 16px;" /><p style="margin:0;color:#8A8F98;font-size:12px;line-height:1.55;text-align:center;">Verzonden door ${escapeHtml(args.salonName)} via GlowSuite. Dit is een servicebericht over je afspraak, betaling of abonnement.</p></td></tr></table></td></tr></table></body></html>`;
}

function infoRows(rows: Array<[string, unknown]>) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #F1EEF7;border-radius:18px;overflow:hidden;margin:16px 0 18px;background:#ffffff;">${rows.filter(([, value]) => value !== undefined && value !== null && String(value) !== "").map(([label, value]) => `<tr><td style="padding:13px 15px;border-bottom:1px solid #F7F3FB;color:#6B7280;font-size:13px;line-height:1.35;">${escapeHtml(label)}</td><td align="right" style="padding:13px 15px;border-bottom:1px solid #F7F3FB;color:#111827;font-size:14px;line-height:1.35;font-weight:750;">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}

function noteBlock(title: string, items: unknown[]) {
  const lines = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!lines.length) return "";
  return `<div style="background:#FCFAFF;border:1px solid #F1EEF7;border-radius:18px;padding:16px 16px;margin:16px 0;"><p style="margin:0 0 10px;color:#111827;font-size:14px;font-weight:800;">${escapeHtml(title)}</p>${lines.map((item) => `<p style="margin:7px 0;color:#5F6673;font-size:14px;line-height:1.55;">• ${escapeHtml(item)}</p>`).join("")}</div>`;
}

function amountSummary(args: { amount?: unknown; vatAmount?: unknown; vatRate?: unknown; total?: unknown }) {
  return `<div style="background:#111827;border-radius:20px;padding:18px;margin:16px 0;color:#ffffff;"><p style="margin:0 0 8px;color:#D1D5DB;font-size:13px;font-weight:700;">Totaal betaald</p><p style="margin:0;color:#ffffff;font-size:30px;line-height:1;font-weight:850;">${escapeHtml(formatEuro(args.total || args.amount))}</p>${args.vatAmount ? `<p style="margin:12px 0 0;color:#D1D5DB;font-size:13px;">Inclusief BTW${args.vatRate ? ` (${escapeHtml(args.vatRate)}%)` : ""}: ${escapeHtml(formatEuro(args.vatAmount))}</p>` : ""}</div>`;
}

function template(key: TemplateKey, data: Record<string, unknown>, salonName: string, branding: any): TemplateResult {
  const firstName = String(data.customer_name || data.recipient_name || "").trim().split(/\s+/)[0] || "";
  const accent = hexColor(branding?.primary_color, "#7B61FF");
  const secondary = hexColor(branding?.secondary_color, "#C850C0");
  const base = { salonName, logoUrl: branding?.logo_url || "", accent, secondary };
  const publicBaseUrl = firstFilled(data.public_base_url, data.base_url) || `https://${slugify(String(data.salon_slug || salonName))}.glowsuite.nl`;
  const manageUrl = absoluteUrl(firstFilled(data.manage_url, data.appointment_url), "/afspraak/beheer", publicBaseUrl);
  const calendarUrl = firstFilled(data.calendar_url, data.add_to_calendar_url);
  const contactUrl = absoluteUrl(firstFilled(data.contact_url, data.route_url, data.location_url), "/route-contact", publicBaseUrl);
  const bookingUrl = absoluteUrl(data.booking_url, "/boeken", publicBaseUrl);
  const receiptUrl = absoluteUrl(firstFilled(data.receipt_url, data.payment_url), "/betaalbewijs", publicBaseUrl);
  const membershipUrl = absoluteUrl(firstFilled(data.membership_url, data.manage_membership_url), "/abonnement-beheren", publicBaseUrl);
  const reviewUrl = absoluteUrl(firstFilled(data.review_url, data.google_review_url), "/review", publicBaseUrl);
  const termsUrl = absoluteUrl(data.terms_url, "/salonvoorwaarden", publicBaseUrl);
  const supportEmail = firstFilled(data.support_email, data.salon_contact_email, branding?.contact_email);

  if (key === "booking_confirmation") {
    const title = "Je afspraak staat klaar";
    const intro = `${firstName ? `${firstName}, je` : "Je"} behandeling bij ${salonName} is bevestigd. We kijken ernaar uit je te ontvangen.`;
    const rows = infoRows([["Klant", data.customer_name || data.recipient_name], ["Datum", nlDate(data.appointment_date || data.date)], ["Tijd", data.time || data.start_time], ["Behandeling", data.service_name], ["Medewerker", data.employee || data.staff_name], ["Locatie", data.location || data.address], ["Referentie", data.reference], ["Totaal", data.total_amount ? formatEuro(data.total_amount) : undefined]]);
    const calendarLink = calendarUrl ? `<a href="${escapeHtml(calendarUrl)}" style="display:block;background:#ffffff;color:${secondary};text-decoration:none;border:1px solid #E9DFF7;border-radius:14px;padding:13px 18px;font-size:14px;font-weight:750;text-align:center;margin:0 0 16px;">Toevoegen aan agenda</a>` : "";
    const body = rows + calendarLink + noteBlock("Handig om te weten", ["Zet je afspraak direct in je agenda.", "Kun je niet komen? Beheer je afspraak op tijd."]) + `<p style="margin:10px 0 18px;color:#8A8F98;font-size:12px;line-height:1.55;text-align:center;">Op deze afspraak gelden de <a href="${escapeHtml(termsUrl)}" style="color:${secondary};text-decoration:underline;">salonvoorwaarden</a>.</p>`;
    return { subject: `${salonName} · je afspraak op ${nlDateShort(data.appointment_date || data.date) || "is bevestigd"}`, preview: intro, html: shell({ ...base, title, intro, body, primaryAction: { label: "Afspraak beheren", url: manageUrl } }), text: `${title}\n${intro}\n${String(data.service_name || "")}\n${nlDate(data.appointment_date || data.date)} ${String(data.time || data.start_time || "")}` };
  }

  if (key === "payment_receipt") {
    const title = "Je betaalbewijs";
    const intro = `Dank je wel. Je betaling aan ${salonName} is veilig verwerkt.`;
    const rows = infoRows([["Betaalmethode", data.method || data.payment_method], ["Omschrijving", data.description || data.service_name || data.membership_name], ["Datum", nlDate(data.paid_at || data.date)], ["Referentie", data.reference || data.receipt_number], ["BTW", data.vat_amount ? formatEuro(data.vat_amount) : data.vat_enabled ? "Actief" : undefined]]);
    const body = amountSummary({ amount: data.amount, vatAmount: data.vat_amount, vatRate: data.vat_rate, total: data.total_amount }) + rows;
    return { subject: `${salonName} · betaalbewijs ${data.reference ? `#${String(data.reference)}` : ""}`.trim(), preview: intro, html: shell({ ...base, title, intro, body, primaryAction: { label: "Bekijk betaalbewijs", url: receiptUrl }, secondaryAction: { label: "Afspraak bekijken", url: manageUrl } }), text: `${title}\n${intro}\nBedrag: ${formatEuro(data.total_amount || data.amount)}\nBetaalmethode: ${String(data.method || data.payment_method || "")}` };
  }

  if (key === "appointment_reminder") {
    const title = "Tot snel bij je afspraak";
    const intro = `${firstName ? `${firstName}, dit` : "Dit"} is een vriendelijke herinnering aan je afspraak bij ${salonName}.`;
    const rows = infoRows([["Datum", nlDate(data.appointment_date || data.date)], ["Tijd", data.time || data.start_time], ["Behandeling", data.service_name], ["Medewerker", data.employee || data.staff_name], ["Locatie", data.location || data.address]]);
    const calendarLink = calendarUrl ? `<a href="${escapeHtml(calendarUrl)}" style="display:block;background:#ffffff;color:${secondary};text-decoration:none;border:1px solid #E9DFF7;border-radius:14px;padding:13px 18px;font-size:14px;font-weight:750;text-align:center;margin:0 0 16px;">Toevoegen aan kalender</a>` : "";
    const body = rows + calendarLink + noteBlock("Voor je afspraak", [data.preparation_tip || "Kom liefst een paar minuten op tijd.", "Ben je verhinderd? Beheer je afspraak op tijd.", data.aftercare_note]);
    return { subject: `${salonName} · herinnering voor ${nlDateShort(data.appointment_date || data.date) || "je afspraak"}`, preview: intro, html: shell({ ...base, title, intro, body, primaryAction: { label: "Afspraak beheren", url: manageUrl }, secondaryAction: { label: "Route bekijken", url: contactUrl } }), text: `${title}\n${intro}\n${nlDate(data.appointment_date || data.date)} ${String(data.time || data.start_time || "")}` };
  }

  if (key === "booking_cancellation") {
    const title = "Je afspraak is geannuleerd";
    const intro = `We bevestigen dat je afspraak bij ${salonName} is geannuleerd. Je bent altijd welkom om een nieuw moment te kiezen.`;
    const rows = infoRows([["Status", data.status || "Geannuleerd"], ["Behandeling", data.service_name], ["Datum", nlDate(data.appointment_date || data.date)], ["Tijd", data.time || data.start_time], ["Referentie", data.reference], ["Support", supportEmail]]);
    const body = rows + noteBlock("Hulp nodig?", ["Neem gerust contact op als dit niet klopt.", supportEmail ? `Je kunt ons bereiken via ${supportEmail}.` : "Ons team helpt je graag met het plannen van een nieuw moment."]);
    return { subject: `${salonName} · annulering bevestigd`, preview: intro, html: shell({ ...base, title, intro, body, primaryAction: { label: "Nieuwe afspraak maken", url: absoluteUrl(data.new_booking_url, "/boeken", publicBaseUrl) }, secondaryAction: { label: "Route bekijken", url: contactUrl } }), text: `${title}\n${intro}\nStatus: geannuleerd` };
  }

  if (key === "membership_notification") {
    const title = "Welkom bij je abonnement";
    const intro = `${firstName ? `${firstName}, welkom` : "Welkom"} bij je abonnement van ${salonName}. Je voordelen staan voor je klaar.`;
    const benefits = Array.isArray(data.benefits) ? data.benefits : [data.benefit_1, data.benefit_2, data.benefit_3];
    const rows = infoRows([["Abonnement", data.membership_name], ["Status", data.status || "Actief"], ["Credits", data.credits || data.credits_status], ["Volgende incasso", nlDate(data.next_payment_at)], ["Maandbedrag", data.amount ? formatEuro(data.amount) : undefined]]);
    const body = rows + noteBlock("Jouw voordelen", benefits);
    return { subject: `${salonName} · welkom bij je abonnement`, preview: intro, html: shell({ ...base, title, intro, body, primaryAction: { label: "Abonnement beheren", url: membershipUrl }, secondaryAction: { label: "Nieuwe afspraak boeken", url: bookingUrl } }), text: `${title}\n${intro}\nAbonnement: ${String(data.membership_name || "")}` };
  }

  const title = "Dank je wel voor je bezoek";
  const intro = `${firstName ? `${firstName}, bedankt` : "Bedankt"} voor je bezoek aan ${salonName}. We hopen dat je tevreden bent met je behandeling.`;
  const body = infoRows([["Behandeling", data.service_name], ["Datum", nlDate(data.appointment_date || data.completed_at || data.date)], ["Medewerker", data.employee || data.staff_name]]) + `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.65;">Met je review help je ons de salonervaring nog beter te maken. Ook help je nieuwe klanten kiezen met vertrouwen.</p>`;
  return { subject: `${salonName} · hoe was je ervaring?`, preview: intro, html: shell({ ...base, title, intro, body, primaryAction: { label: "Review schrijven", url: reviewUrl }, secondaryAction: { label: "Nieuwe afspraak boeken", url: absoluteUrl(data.rebook_url, "/boeken", publicBaseUrl) } }), text: `${title}\n${intro}` };
}

async function logEmail(admin: ReturnType<typeof createClient>, row: Record<string, unknown>) {
  await admin.from("white_label_email_logs").insert(row as any);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Methode niet toegestaan" }, 405);

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) return json({ error: "Ongeldige invoer", details: parsed.error.flatten().fieldErrors }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: settings, error: settingsError } = await admin
      .from("settings")
      .select("user_id, salon_name, public_slug, whitelabel_branding, demo_mode, is_demo")
      .eq("user_id", parsed.data.user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (settingsError) throw settingsError;
    if (!settings) return json({ error: "Salon niet gevonden" }, 404);

    const { data: profile } = await admin
      .from("profiles")
      .select("email")
      .eq("user_id", parsed.data.user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const branding = (settings as any).whitelabel_branding || {};
    const salonName = parsed.data.salon_name || (settings as any).salon_name || branding.salon_name || "Salon";
    const salonSlug = uniqueSalonSlug({ requested: parsed.data.salon_slug, publicSlug: (settings as any).public_slug, salonName, userId: parsed.data.user_id });
    const fromEmail = `${salonSlug}@${SENDER_DOMAIN}`;
    const replyTo = validReplyTo((parsed.data.template_data as any).salon_contact_email || branding.contact_email || (profile as any)?.email);
    const rendered = template(parsed.data.template_key, { ...parsed.data.template_data, recipient_name: parsed.data.recipient_name }, salonName, branding);
    const commonLog = {
      user_id: parsed.data.user_id,
      salon_slug: salonSlug,
      from_email: fromEmail,
      from_name: salonName,
      recipient_email: parsed.data.recipient_email.toLowerCase(),
      template_key: parsed.data.template_key,
      subject: rendered.subject,
      provider: "resend",
      metadata: { idempotency_key: parsed.data.idempotency_key, preview: rendered.preview, reply_to: replyTo || null },
      is_demo: Boolean((settings as any).is_demo || (settings as any).demo_mode),
    };

    if (parsed.data.preview_only || (settings as any).is_demo || (settings as any).demo_mode) {
      await logEmail(admin, { ...commonLog, status: parsed.data.preview_only ? "preview" : "demo_skipped" });
      return json({
        success: true,
        preview_only: true,
        from: `${salonName} <${fromEmail}>`,
        reply_to: replyTo || null,
        subject: rendered.subject,
        preview: rendered.preview,
        html: rendered.html,
        text: rendered.text,
      });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is niet geconfigureerd");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is niet geconfigureerd");

    const response = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${salonName} <${fromEmail}>`,
        to: [parsed.data.recipient_email.toLowerCase()],
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
        headers: { "Idempotency-Key": parsed.data.idempotency_key },
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      await logEmail(admin, { ...commonLog, status: "failed", error_message: JSON.stringify(result).slice(0, 1000) });
      return json({ error: "Email kon niet worden verzonden", details: result }, 502);
    }

    await logEmail(admin, { ...commonLog, status: "sent", provider_message_id: result?.id || result?.data?.id || null });
    return json({ success: true, from: `${salonName} <${fromEmail}>`, reply_to: replyTo || null, subject: rendered.subject, provider_message_id: result?.id || result?.data?.id || null });
  } catch (error) {
    return json({ error: (error as Error).message || "Email kon niet worden verwerkt" }, 500);
  }
});
