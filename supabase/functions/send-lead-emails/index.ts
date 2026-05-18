// Send lead confirmation + internal notification emails via Resend gateway.
// Uses the shared GlowSuite platform email layout.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  renderGlowSuiteEmail,
  softCardHtml,
  esc,
  GLOWSUITE_FROM,
  GLOWSUITE_REPLY_TO,
} from "../_shared/glowsuiteEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const ADMIN_EMAIL = "ccfrancoisinc@gmail.com";
const FROM_INTERNAL = "GlowSuite Leads <leads@email.glowsuite.nl>";

interface LeadPayload {
  name: string;
  email: string;
  phone?: string | null;
  salon_name?: string | null;
  salon_type?: string | null;
  message?: string | null;
  source?: string | null;
}

async function sendEmail(
  apiKey: string,
  lovableKey: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": apiKey,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY is not configured");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const lead: LeadPayload = await req.json();
    if (!lead?.email || !lead?.name) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const now = new Date().toLocaleString("nl-NL", {
      timeZone: "Europe/Amsterdam",
    });

    // 1. Confirmation to lead — premium GlowSuite layout
    const confirmationHtml = renderGlowSuiteEmail({
      title: "We hebben je demo-aanvraag ontvangen",
      preheader: "We nemen binnen 24 uur contact met je op om de demo in te plannen.",
      eyebrow: "Demo-aanvraag",
      heading: "Je demo-aanvraag is ontvangen",
      intro:
        "Bedankt voor je interesse in GlowSuite. We nemen binnen 24 uur contact met je op om de demo in te plannen.",
      helper: "Geen actie nodig — je hoort snel van ons.",
    });

    const confirmationText =
      "Je demo-aanvraag is ontvangen\n\n" +
      "Bedankt voor je interesse in GlowSuite. We nemen binnen 24 uur contact met je op om de demo in te plannen.\n\n" +
      "Team GlowSuite";

    // 2. Internal notification — also GlowSuite-branded
    const rows = [
      ["Naam", lead.name],
      ["Salonnaam", lead.salon_name ?? "—"],
      ["Type salon", lead.salon_type ?? "—"],
      ["E-mail", lead.email],
      ["Telefoon", lead.phone ?? "—"],
      ["Bericht", lead.message ?? "—"],
      ["Bron", lead.source ?? "—"],
      ["Datum/tijd", now],
    ];
    const tableRows = rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 12px 6px 0;font-size:13px;color:#64748b;vertical-align:top;width:120px;">${esc(k)}</td><td style="padding:6px 0;font-size:14px;color:#0f172a;white-space:pre-wrap;">${esc(String(v))}</td></tr>`,
      )
      .join("");
    const internalHtml = renderGlowSuiteEmail({
      title: "Nieuwe demo lead ontvangen",
      preheader: `Nieuwe lead: ${lead.name}${lead.salon_name ? " · " + lead.salon_name : ""}`,
      eyebrow: "Nieuwe lead",
      heading: "Nieuwe demo-aanvraag",
      intro: "Er is zojuist een nieuwe demo-aanvraag binnengekomen via GlowSuite.",
      bodyHtml: softCardHtml(
        `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${tableRows}</table>`,
      ),
      ctaLabel: "Antwoord deze lead",
      ctaUrl: `mailto:${lead.email}`,
      footerNote: "Interne notificatie — verstuurd door GlowSuite Leads.",
    });

    const internalText =
      `Nieuwe demo lead ontvangen\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join("\n");

    const [confirmation, internal] = await Promise.all([
      sendEmail(RESEND_API_KEY, LOVABLE_API_KEY, {
        from: GLOWSUITE_FROM,
        to: [lead.email],
        reply_to: GLOWSUITE_REPLY_TO,
        subject: "We hebben je demo-aanvraag ontvangen",
        html: confirmationHtml,
        text: confirmationText,
      }),
      sendEmail(RESEND_API_KEY, LOVABLE_API_KEY, {
        from: FROM_INTERNAL,
        to: [ADMIN_EMAIL],
        reply_to: lead.email,
        subject: `Nieuwe demo-aanvraag · ${lead.name}`,
        html: internalHtml,
        text: internalText,
      }),
    ]);

    if (!confirmation.ok)
      console.error("Confirmation send failed:", confirmation.status, confirmation.body);
    if (!internal.ok)
      console.error("Internal send failed:", internal.status, internal.body);

    return new Response(
      JSON.stringify({
        confirmation: { ok: confirmation.ok, status: confirmation.status },
        internal: { ok: internal.ok, status: internal.status },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("send-lead-emails error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
