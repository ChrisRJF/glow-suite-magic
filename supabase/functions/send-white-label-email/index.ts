import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const SENDER_DOMAIN = "email.glowsuite.nl";
const FROM_EMAIL = `bookings@${SENDER_DOMAIN}`;

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

function shell(args: { salonName: string; title: string; intro: string; body: string; ctaLabel?: string; ctaUrl?: string; logoUrl?: string; accent?: string }) {
  const accent = args.accent || "#7B61FF";
  const logo = args.logoUrl ? `<img src="${escapeHtml(args.logoUrl)}" width="52" height="52" alt="${escapeHtml(args.salonName)}" style="border-radius:14px;display:block;margin-bottom:18px;object-fit:cover;" />` : "";
  const cta = args.ctaUrl ? `<a href="${escapeHtml(args.ctaUrl)}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;border-radius:12px;padding:13px 18px;font-size:14px;font-weight:700;margin-top:8px;">${escapeHtml(args.ctaLabel || "Bekijk details")}</a>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(args.title)}</title></head><body style="margin:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#111827;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(args.intro)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;"><tr><td align="center" style="padding:28px 16px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border:1px solid #eee7f8;border-radius:22px;overflow:hidden;background:#ffffff;"><tr><td style="padding:28px 26px 10px;">${logo}<p style="margin:0 0 8px;color:${accent};font-size:13px;font-weight:700;letter-spacing:.02em;">${escapeHtml(args.salonName)}</p><h1 style="margin:0;color:#111827;font-size:25px;line-height:1.18;font-weight:750;">${escapeHtml(args.title)}</h1><p style="margin:14px 0 0;color:#6B7280;font-size:15px;line-height:1.6;">${escapeHtml(args.intro)}</p></td></tr><tr><td style="padding:12px 26px 26px;">${args.body}${cta}<hr style="border:none;border-top:1px solid #F1EEF7;margin:26px 0 16px;" /><p style="margin:0;color:#8A8F98;font-size:12px;line-height:1.5;">Verzonden door ${escapeHtml(args.salonName)} via GlowSuite. Veilig opgeslagen en automatisch gesynchroniseerd.</p></td></tr></table></td></tr></table></body></html>`;
}

function infoRows(rows: Array<[string, unknown]>) {
  return `<div style="border:1px solid #F1EEF7;border-radius:16px;overflow:hidden;margin:14px 0 18px;">${rows.filter(([, value]) => value !== undefined && value !== null && String(value) !== "").map(([label, value]) => `<div style="display:flex;justify-content:space-between;gap:14px;padding:12px 14px;border-bottom:1px solid #F7F3FB;"><span style="color:#6B7280;font-size:13px;">${escapeHtml(label)}</span><strong style="color:#111827;font-size:13px;text-align:right;">${escapeHtml(value)}</strong></div>`).join("")}</div>`;
}

function template(key: TemplateKey, data: Record<string, unknown>, salonName: string, branding: any): TemplateResult {
  const firstName = String(data.customer_name || data.recipient_name || "").trim().split(/\s+/)[0] || "";
  const accent = branding?.primary_color || "#7B61FF";
  const base = { salonName, logoUrl: branding?.logo_url || "", accent };

  if (key === "booking_confirmation") {
    const title = "Je afspraak is bevestigd";
    const intro = `${firstName ? `${firstName}, je` : "Je"} afspraak bij ${salonName} staat vast.`;
    const rows = infoRows([["Behandeling", data.service_name], ["Datum", nlDate(data.appointment_date || data.date)], ["Tijd", data.time], ["Medewerker", data.employee], ["Referentie", data.reference], ["Totaal", data.total_amount ? formatEuro(data.total_amount) : undefined]]);
    return { subject: `${salonName} · afspraak bevestigd`, preview: intro, html: shell({ ...base, title, intro, body: rows }), text: `${title}\n${intro}` };
  }

  if (key === "payment_receipt") {
    const title = "Betaling ontvangen";
    const intro = `We hebben je betaling aan ${salonName} veilig ontvangen.`;
    const rows = infoRows([["Bedrag", formatEuro(data.amount)], ["Betaalmethode", data.method], ["Omschrijving", data.description || data.service_name || data.membership_name], ["Referentie", data.reference]]);
    return { subject: `${salonName} · betalingsbewijs`, preview: intro, html: shell({ ...base, title, intro, body: rows }), text: `${title}\n${intro}\nBedrag: ${formatEuro(data.amount)}` };
  }

  if (key === "appointment_reminder") {
    const title = "Herinnering aan je afspraak";
    const intro = `${firstName ? `${firstName}, vergeet` : "Vergeet"} je afspraak bij ${salonName} niet.`;
    const rows = infoRows([["Behandeling", data.service_name], ["Datum", nlDate(data.appointment_date || data.date)], ["Tijd", data.time], ["Medewerker", data.employee]]);
    return { subject: `${salonName} · herinnering afspraak`, preview: intro, html: shell({ ...base, title, intro, body: rows }), text: `${title}\n${intro}` };
  }

  if (key === "booking_cancellation") {
    const title = "Je afspraak is geannuleerd";
    const intro = `Je afspraak bij ${salonName} is geannuleerd. Neem gerust contact op om opnieuw te plannen.`;
    const rows = infoRows([["Behandeling", data.service_name], ["Datum", nlDate(data.appointment_date || data.date)], ["Tijd", data.time], ["Referentie", data.reference]]);
    return { subject: `${salonName} · afspraak geannuleerd`, preview: intro, html: shell({ ...base, title, intro, body: rows }), text: `${title}\n${intro}` };
  }

  if (key === "membership_notification") {
    const title = "Update over je membership";
    const intro = `Er is een update over je membership bij ${salonName}.`;
    const rows = infoRows([["Membership", data.membership_name], ["Status", data.status], ["Credits", data.credits], ["Volgende betaling", nlDate(data.next_payment_at)], ["Bedrag", data.amount ? formatEuro(data.amount) : undefined]]);
    return { subject: `${salonName} · membership update`, preview: intro, html: shell({ ...base, title, intro, body: rows }), text: `${title}\n${intro}` };
  }

  const title = "Hoe was je behandeling?";
  const intro = `${firstName ? `${firstName}, we` : "We"} horen graag hoe je ervaring bij ${salonName} was.`;
  return { subject: `${salonName} · deel je ervaring`, preview: intro, html: shell({ ...base, title, intro, body: `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">Je feedback helpt de salon groeien en helpt andere klanten kiezen met vertrouwen.</p>`, ctaLabel: "Review achterlaten", ctaUrl: String(data.review_url || "") || undefined }), text: `${title}\n${intro}` };
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

    const branding = (settings as any).whitelabel_branding || {};
    const salonName = parsed.data.salon_name || (settings as any).salon_name || branding.salon_name || "Salon";
    const salonSlug = slugify(parsed.data.salon_slug || (settings as any).public_slug || salonName);
    const fromEmail = FROM_EMAIL;
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
      metadata: { idempotency_key: parsed.data.idempotency_key, preview: rendered.preview },
      is_demo: Boolean((settings as any).is_demo || (settings as any).demo_mode),
    };

    if (parsed.data.preview_only || (settings as any).is_demo || (settings as any).demo_mode) {
      await logEmail(admin, { ...commonLog, status: parsed.data.preview_only ? "preview" : "demo_skipped" });
      return json({
        success: true,
        preview_only: true,
        from: `${salonName} <${fromEmail}>`,
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
        headers: { "Idempotency-Key": parsed.data.idempotency_key },
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      await logEmail(admin, { ...commonLog, status: "failed", error_message: JSON.stringify(result).slice(0, 1000) });
      return json({ error: "Email kon niet worden verzonden", details: result }, 502);
    }

    await logEmail(admin, { ...commonLog, status: "sent", provider_message_id: result?.id || result?.data?.id || null });
    return json({ success: true, from: `${salonName} <${fromEmail}>`, subject: rendered.subject, provider_message_id: result?.id || result?.data?.id || null });
  } catch (error) {
    return json({ error: (error as Error).message || "Email kon niet worden verwerkt" }, 500);
  }
});
