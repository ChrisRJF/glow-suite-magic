import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";
import {
  emailStrings,
  formatCurrency,
  formatDateLong,
  formatDateShort,
  normalizeEmailLang,
  type EmailLang,
} from "../_shared/emailTranslations.ts";

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

const LangSchema = z.enum(["nl", "en", "de", "fr", "es"]);

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
  language: LangSchema.optional(),
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

function hexColor(value: unknown, fallback: string) {
  const color = String(value || "").trim();
  return /^#[0-9A-Fa-f]{6}$/.test(color) ? color : fallback;
}

function firstFilled(...values: unknown[]) {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) || "";
}

function absoluteUrl(value: unknown, fallbackPath: string, baseUrl: string) {
  const raw = String(value ?? "").trim();
  if (/^https?:\/\//i.test(raw)) return raw;
  const path = raw && raw !== "#" ? raw : fallbackPath;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function shell(args: { salonName: string; title: string; intro: string; body: string; primaryAction?: Action; secondaryAction?: Action; logoUrl?: string; accent?: string; secondary?: string; lang: EmailLang; footerText: string }) {
  const accent = hexColor(args.accent, "#7B61FF");
  const secondary = hexColor(args.secondary, "#C850C0");
  const logo = args.logoUrl ? `<img src="${escapeHtml(args.logoUrl)}" width="56" height="56" alt="${escapeHtml(args.salonName)}" style="border-radius:16px;display:block;margin:0 auto 18px;object-fit:cover;border:1px solid #F1EEF7;" />` : `<div style="width:56px;height:56px;border-radius:16px;margin:0 auto 18px;background:${accent};color:#ffffff;text-align:center;line-height:56px;font-size:20px;font-weight:800;">${escapeHtml(args.salonName.slice(0, 1).toUpperCase())}</div>`;
  const primaryCta = args.primaryAction?.url ? `<a href="${escapeHtml(args.primaryAction.url)}" style="display:block;background:${accent};color:#ffffff;text-decoration:none;border-radius:14px;padding:15px 18px;font-size:15px;font-weight:800;text-align:center;margin:18px 0 10px;">${escapeHtml(args.primaryAction.label)}</a>` : "";
  const secondaryCta = args.secondaryAction?.url ? `<a href="${escapeHtml(args.secondaryAction.url)}" style="display:block;background:#ffffff;color:${secondary};text-decoration:none;border:1px solid #E9DFF7;border-radius:14px;padding:13px 18px;font-size:14px;font-weight:750;text-align:center;margin:0 0 8px;">${escapeHtml(args.secondaryAction.label)}</a>` : "";
  return `<!doctype html><html lang="${args.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(args.title)}</title></head><body style="margin:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;-webkit-font-smoothing:antialiased;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(args.intro)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;"><tr><td align="center" style="padding:22px 12px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:584px;border:1px solid #EEE7F8;border-radius:24px;overflow:hidden;background:#ffffff;"><tr><td style="padding:30px 24px 18px;text-align:center;background:linear-gradient(180deg,#FFFFFF 0%,#FCFAFF 100%);">${logo}<p style="margin:0 0 9px;color:${accent};font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;">${escapeHtml(args.salonName)}</p><h1 style="margin:0;color:#111827;font-size:26px;line-height:1.16;font-weight:800;letter-spacing:0;">${escapeHtml(args.title)}</h1><p style="margin:14px auto 0;color:#5F6673;font-size:16px;line-height:1.62;max-width:480px;">${escapeHtml(args.intro)}</p></td></tr><tr><td style="padding:8px 24px 30px;">${args.body}${primaryCta}${secondaryCta}<hr style="border:none;border-top:1px solid #F1EEF7;margin:26px 0 16px;" /><p style="margin:0;color:#8A8F98;font-size:12px;line-height:1.55;text-align:center;">${escapeHtml(args.footerText)}</p></td></tr></table></td></tr></table></body></html>`;
}

function infoRows(rows: Array<[string, unknown]>) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #F1EEF7;border-radius:18px;overflow:hidden;margin:16px 0 18px;background:#ffffff;">${rows.filter(([, value]) => value !== undefined && value !== null && String(value) !== "").map(([label, value]) => `<tr><td style="padding:13px 15px;border-bottom:1px solid #F7F3FB;color:#6B7280;font-size:13px;line-height:1.35;">${escapeHtml(label)}</td><td align="right" style="padding:13px 15px;border-bottom:1px solid #F7F3FB;color:#111827;font-size:14px;line-height:1.35;font-weight:750;">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}

function noteBlock(title: string, items: unknown[]) {
  const lines = items.map((item) => String(item ?? "").trim()).filter(Boolean);
  if (!lines.length) return "";
  return `<div style="background:#FCFAFF;border:1px solid #F1EEF7;border-radius:18px;padding:16px 16px;margin:16px 0;"><p style="margin:0 0 10px;color:#111827;font-size:14px;font-weight:800;">${escapeHtml(title)}</p>${lines.map((item) => `<p style="margin:7px 0;color:#5F6673;font-size:14px;line-height:1.55;">• ${escapeHtml(item)}</p>`).join("")}</div>`;
}

function amountSummary(args: { amount?: unknown; vatAmount?: unknown; vatRate?: unknown; total?: unknown; totalLabel: string; vatLine?: string }) {
  return `<div style="background:#111827;border-radius:20px;padding:18px;margin:16px 0;color:#ffffff;"><p style="margin:0 0 8px;color:#D1D5DB;font-size:13px;font-weight:700;">${escapeHtml(args.totalLabel)}</p><p style="margin:0;color:#ffffff;font-size:30px;line-height:1;font-weight:850;">${escapeHtml(args.total as string)}</p>${args.vatLine ? `<p style="margin:12px 0 0;color:#D1D5DB;font-size:13px;">${escapeHtml(args.vatLine)}</p>` : ""}</div>`;
}

function template(key: TemplateKey, data: Record<string, unknown>, salonName: string, branding: any, lang: EmailLang): TemplateResult {
  const s = emailStrings(lang);
  const sh = s.shared;
  const firstName = String(data.customer_name || data.recipient_name || "").trim().split(/\s+/)[0] || "";
  const accent = hexColor(branding?.primary_color, "#7B61FF");
  const secondary = hexColor(branding?.secondary_color, "#C850C0");
  const base = { salonName, logoUrl: branding?.logo_url || "", accent, secondary, lang, footerText: sh.footer(salonName) };
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
    const t = s.booking_confirmation;
    const dateShort = formatDateShort(data.appointment_date || data.date, lang);
    const title = t.title;
    const intro = firstName ? t.intro_named(firstName, salonName) : t.intro(salonName);
    const rows = infoRows([
      [sh.row_customer, data.customer_name || data.recipient_name],
      [sh.row_date, formatDateLong(data.appointment_date || data.date, lang)],
      [sh.row_time, data.time || data.start_time],
      [sh.row_service, data.service_name],
      [sh.row_staff, data.employee || data.staff_name],
      [sh.row_location, data.location || data.address],
      [sh.row_reference, data.reference],
      [sh.row_total, data.total_amount ? formatCurrency(data.total_amount, lang) : undefined],
    ]);
    const calendarLink = calendarUrl ? `<a href="${escapeHtml(calendarUrl)}" style="display:block;background:#ffffff;color:${secondary};text-decoration:none;border:1px solid #E9DFF7;border-radius:14px;padding:13px 18px;font-size:14px;font-weight:750;text-align:center;margin:0 0 16px;">${escapeHtml(t.cta_calendar)}</a>` : "";
    const termsLink = t.terms_line(escapeHtml(termsUrl)).replace("<a href=", `<a style="color:${secondary};text-decoration:underline;" href=`);
    const body = rows + calendarLink + noteBlock(t.note_title, [t.note_1, t.note_2]) + `<p style="margin:10px 0 18px;color:#8A8F98;font-size:12px;line-height:1.55;text-align:center;">${termsLink}</p>`;
    return {
      subject: dateShort ? t.subject(salonName, dateShort) : t.subject_no_date(salonName),
      preview: intro,
      html: shell({ ...base, title, intro, body, primaryAction: { label: t.cta_manage, url: manageUrl }, secondaryAction: { label: t.cta_route, url: contactUrl } }),
      text: `${title}\n${intro}\n${String(data.service_name || "")}\n${formatDateLong(data.appointment_date || data.date, lang)} ${String(data.time || data.start_time || "")}`,
    };
  }

  if (key === "payment_receipt") {
    const t = s.payment_receipt;
    const title = t.title;
    const intro = t.intro(salonName);
    const totalStr = formatCurrency(data.total_amount || data.amount, lang);
    const vatStr = data.vat_amount ? formatCurrency(data.vat_amount, lang) : "";
    const vatLine = vatStr ? (data.vat_rate ? t.vat_line(vatStr, String(data.vat_rate)) : t.vat_no_rate(vatStr)) : undefined;
    const rows = infoRows([
      [sh.row_method, data.method || data.payment_method],
      [sh.row_description, data.description || data.service_name || data.membership_name],
      [sh.row_date, formatDateLong(data.paid_at || data.date, lang)],
      [sh.row_reference, data.reference || data.receipt_number],
      [sh.row_vat, data.vat_amount ? formatCurrency(data.vat_amount, lang) : data.vat_enabled ? sh.row_vat_active : undefined],
    ]);
    const body = amountSummary({ total: totalStr, totalLabel: t.total_label, vatLine }) + rows;
    return {
      subject: t.subject(salonName, String(data.reference || "")).trim(),
      preview: intro,
      html: shell({ ...base, title, intro, body, primaryAction: { label: t.cta_receipt, url: receiptUrl }, secondaryAction: { label: t.cta_appointment, url: manageUrl } }),
      text: `${title}\n${intro}\n${totalStr}\n${String(data.method || data.payment_method || "")}`,
    };
  }

  if (key === "appointment_reminder") {
    const t = s.appointment_reminder;
    const dateShort = formatDateShort(data.appointment_date || data.date, lang);
    const title = t.title;
    const intro = firstName ? t.intro_named(firstName, salonName) : t.intro(salonName);
    const rows = infoRows([
      [sh.row_date, formatDateLong(data.appointment_date || data.date, lang)],
      [sh.row_time, data.time || data.start_time],
      [sh.row_service, data.service_name],
      [sh.row_staff, data.employee || data.staff_name],
      [sh.row_location, data.location || data.address],
    ]);
    const calendarLink = calendarUrl ? `<a href="${escapeHtml(calendarUrl)}" style="display:block;background:#ffffff;color:${secondary};text-decoration:none;border:1px solid #E9DFF7;border-radius:14px;padding:13px 18px;font-size:14px;font-weight:750;text-align:center;margin:0 0 16px;">${escapeHtml(t.cta_calendar)}</a>` : "";
    // Explicit Ja / Nee confirmation buttons — only shown when we have a
    // confirmation link (built from the appointment booking token). Falls back
    // to the standard "Manage" CTA when the link is missing.
    const confirmUrl = String(data.confirm_url || "").trim();
    const declineUrl = String(data.decline_url || "").trim();
    const hasConfirmFlow = /^https?:\/\//i.test(confirmUrl) && /^https?:\/\//i.test(declineUrl);
    const confirmBlock = hasConfirmFlow
      ? `<div style="margin:18px 0 10px;"><p style="margin:0 0 10px;color:#111827;font-size:14px;font-weight:700;text-align:center;">${escapeHtml(t.confirm_intro)}</p><a href="${escapeHtml(confirmUrl)}" style="display:block;background:${accent};color:#ffffff;text-decoration:none;border-radius:14px;padding:15px 18px;font-size:15px;font-weight:800;text-align:center;margin:0 0 10px;">${escapeHtml(t.cta_confirm)}</a><a href="${escapeHtml(declineUrl)}" style="display:block;background:#ffffff;color:#111827;text-decoration:none;border:1px solid #E5E7EB;border-radius:14px;padding:13px 18px;font-size:14px;font-weight:700;text-align:center;margin:0;">${escapeHtml(t.cta_decline)}</a></div>`
      : "";
    const body = rows + calendarLink + confirmBlock + noteBlock(t.note_title, [data.preparation_tip || t.note_default_tip, t.note_reschedule, data.aftercare_note]);
    // If we have the confirm flow, keep "Beheer je afspraak" as the secondary
    // CTA (a smaller link). Otherwise it stays as the primary action.
    const primaryAction = hasConfirmFlow
      ? undefined
      : { label: t.cta_manage, url: manageUrl };
    const secondaryAction = hasConfirmFlow
      ? { label: t.cta_manage, url: manageUrl }
      : { label: t.cta_route, url: contactUrl };
    return {
      subject: t.subject(salonName, dateShort || ""),
      preview: intro,
      html: shell({ ...base, title, intro, body, primaryAction, secondaryAction }),
      text: `${title}\n${intro}\n${formatDateLong(data.appointment_date || data.date, lang)} ${String(data.time || data.start_time || "")}${hasConfirmFlow ? `\n\n${t.confirm_intro}\n${t.cta_confirm}: ${confirmUrl}\n${t.cta_decline}: ${declineUrl}` : ""}`,
    };
  }

  if (key === "booking_cancellation") {
    const t = s.booking_cancellation;
    const title = t.title;
    const intro = t.intro(salonName);
    const rows = infoRows([
      [sh.row_status, t.status_cancelled],
      [sh.row_service, data.service_name],
      [sh.row_date, formatDateLong(data.appointment_date || data.date, lang)],
      [sh.row_time, data.time || data.start_time],
      [sh.row_reference, data.reference],
      [sh.row_support, supportEmail],
    ]);
    const body = rows + noteBlock(t.note_title, [t.note_check, supportEmail ? t.note_contact(supportEmail) : t.note_help]);
    return {
      subject: t.subject(salonName),
      preview: intro,
      html: shell({ ...base, title, intro, body, primaryAction: { label: t.cta_new, url: absoluteUrl(data.new_booking_url, "/boeken", publicBaseUrl) }, secondaryAction: { label: t.cta_route, url: contactUrl } }),
      text: `${title}\n${intro}`,
    };
  }

  if (key === "membership_notification") {
    const t = s.membership_notification;
    const title = t.title;
    const intro = firstName ? t.intro_named(firstName, salonName) : t.intro(salonName);
    const benefits = Array.isArray(data.benefits) ? data.benefits : [data.benefit_1, data.benefit_2, data.benefit_3];
    const rows = infoRows([
      [sh.row_membership, data.membership_name],
      [sh.row_status, data.status || t.status_active],
      [sh.row_credits, data.credits ?? data.credits_status],
      [sh.row_next_payment, formatDateLong(data.next_payment_at, lang)],
      [sh.row_monthly, data.amount ? formatCurrency(data.amount, lang) : undefined],
    ]);
    const body = rows + noteBlock(t.benefits_title, benefits);
    return {
      subject: t.subject(salonName),
      preview: intro,
      html: shell({ ...base, title, intro, body, primaryAction: { label: t.cta_manage, url: membershipUrl }, secondaryAction: { label: t.cta_book, url: bookingUrl } }),
      text: `${title}\n${intro}\n${String(data.membership_name || "")}`,
    };
  }

  // review_request
  const t = s.review_request;
  const title = t.title;
  const intro = firstName ? t.intro_named(firstName, salonName) : t.intro(salonName);
  const body = infoRows([
    [sh.row_service, data.service_name],
    [sh.row_date, formatDateLong(data.appointment_date || data.completed_at || data.date, lang)],
    [sh.row_staff, data.employee || data.staff_name],
  ]) + `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.65;">${escapeHtml(t.body_text)}</p>`;
  return {
    subject: t.subject(salonName),
    preview: intro,
    html: shell({ ...base, title, intro, body, primaryAction: { label: t.cta_review, url: reviewUrl }, secondaryAction: { label: t.cta_rebook, url: absoluteUrl(data.rebook_url, "/boeken", publicBaseUrl) } }),
    text: `${title}\n${intro}`,
  };
}

async function logEmail(admin: ReturnType<typeof createClient>, row: Record<string, unknown>) {
  await admin.from("white_label_email_logs").insert(row as any);
}

async function resolveLanguage(
  admin: ReturnType<typeof createClient>,
  explicit: EmailLang | undefined,
  userId: string,
  recipientEmail: string,
  settings: any,
): Promise<EmailLang> {
  if (explicit) return explicit;
  // Lookup customer by email + user_id and use preferred_language if set.
  try {
    const { data: customer } = await admin
      .from("customers")
      .select("preferred_language")
      .eq("user_id", userId)
      .eq("email", recipientEmail.toLowerCase())
      .maybeSingle();
    const customerLang = (customer as any)?.preferred_language;
    if (customerLang) return normalizeEmailLang(customerLang);
  } catch (_e) { /* ignore */ }
  // Fall back to salon's configured language.
  const settingsLang = (settings as any)?.language;
  if (settingsLang) return normalizeEmailLang(settingsLang);
  return "nl";
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
      .select("user_id, salon_name, public_slug, whitelabel_branding, demo_mode, is_demo, language")
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
    const lang = await resolveLanguage(admin, parsed.data.language, parsed.data.user_id, parsed.data.recipient_email, settings);
    const rendered = template(parsed.data.template_key, { ...parsed.data.template_data, recipient_name: parsed.data.recipient_name, salon_slug: salonSlug }, salonName, branding, lang);
    const commonLog = {
      user_id: parsed.data.user_id,
      salon_slug: salonSlug,
      from_email: fromEmail,
      from_name: salonName,
      recipient_email: parsed.data.recipient_email.toLowerCase(),
      template_key: parsed.data.template_key,
      subject: rendered.subject,
      provider: "resend",
      metadata: { idempotency_key: parsed.data.idempotency_key, preview: rendered.preview, reply_to: replyTo || null, language: lang },
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
        language: lang,
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
    return json({ success: true, from: `${salonName} <${fromEmail}>`, reply_to: replyTo || null, subject: rendered.subject, provider_message_id: result?.id || result?.data?.id || null, language: lang });
  } catch (error) {
    return json({ error: (error as Error).message || "Email kon niet worden verwerkt" }, 500);
  }
});
