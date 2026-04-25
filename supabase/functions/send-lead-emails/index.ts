// Send lead confirmation + internal notification emails via Resend gateway.
// Uses verified domain email.glowsuite.nl
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const ADMIN_EMAIL = "ccfrancoisinc@gmail.com";
const FROM_LEAD = "GlowSuite <hello@email.glowsuite.nl>";
const FROM_INTERNAL = "GlowSuite Leads <leads@email.glowsuite.nl>";
const REPLY_TO = "hello@email.glowsuite.nl";

interface LeadPayload {
  name: string;
  email: string;
  phone?: string | null;
  salon_name?: string | null;
  salon_type?: string | null;
  message?: string | null;
  source?: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

    const name = escapeHtml(lead.name);
    const email = escapeHtml(lead.email);
    const phone = escapeHtml(lead.phone ?? "");
    const salonName = escapeHtml(lead.salon_name ?? "");
    const salonType = escapeHtml(lead.salon_type ?? "");
    const message = escapeHtml(lead.message ?? "");
    const source = escapeHtml(lead.source ?? "");
    const now = new Date().toLocaleString("nl-NL", {
      timeZone: "Europe/Amsterdam",
    });

    // 1. Confirmation to lead
    const confirmationHtml = `
<!doctype html><html><body style="font-family:Arial,sans-serif;background:#ffffff;color:#111;padding:24px;max-width:560px;margin:0 auto;">
  <h2 style="margin:0 0 16px;font-size:20px;">Bedankt voor uw aanvraag</h2>
  <p style="font-size:14px;line-height:1.6;color:#333;">Bedankt voor uw interesse in GlowSuite.</p>
  <p style="font-size:14px;line-height:1.6;color:#333;">Wij hebben uw aanvraag goed ontvangen.</p>
  <p style="font-size:14px;line-height:1.6;color:#333;">Wij nemen binnen 24 uur contact met u op voor een demo.</p>
  <p style="font-size:13px;color:#666;margin-top:24px;">Met vriendelijke groet,<br/>Team GlowSuite</p>
</body></html>`.trim();

    const confirmationText =
      "Bedankt voor uw interesse in GlowSuite.\n\n" +
      "Wij hebben uw aanvraag goed ontvangen.\n" +
      "Wij nemen binnen 24 uur contact met u op voor een demo.\n\n" +
      "Met vriendelijke groet,\nTeam GlowSuite";

    // 2. Internal notification
    const internalHtml = `
<!doctype html><html><body style="font-family:Arial,sans-serif;background:#ffffff;color:#111;padding:24px;max-width:600px;margin:0 auto;">
  <h2 style="margin:0 0 16px;font-size:20px;">Nieuwe demo lead ontvangen</h2>
  <table style="width:100%;border-collapse:collapse;font-size:14px;">
    <tr><td style="padding:8px 0;color:#666;width:140px;">Naam</td><td style="padding:8px 0;font-weight:600;">${name}</td></tr>
    <tr><td style="padding:8px 0;color:#666;">Salonnaam</td><td style="padding:8px 0;">${salonName || "—"}</td></tr>
    <tr><td style="padding:8px 0;color:#666;">Type salon</td><td style="padding:8px 0;">${salonType || "—"}</td></tr>
    <tr><td style="padding:8px 0;color:#666;">E-mail</td><td style="padding:8px 0;"><a href="mailto:${email}">${email}</a></td></tr>
    <tr><td style="padding:8px 0;color:#666;">Telefoon</td><td style="padding:8px 0;">${phone || "—"}</td></tr>
    <tr><td style="padding:8px 0;color:#666;vertical-align:top;">Bericht</td><td style="padding:8px 0;white-space:pre-wrap;">${message || "—"}</td></tr>
    <tr><td style="padding:8px 0;color:#666;">Bron</td><td style="padding:8px 0;">${source || "—"}</td></tr>
    <tr><td style="padding:8px 0;color:#666;">Datum/tijd</td><td style="padding:8px 0;">${now}</td></tr>
  </table>
</body></html>`.trim();

    const internalText =
      `Nieuwe demo lead ontvangen\n\n` +
      `Naam: ${lead.name}\n` +
      `Salonnaam: ${lead.salon_name ?? "—"}\n` +
      `Type salon: ${lead.salon_type ?? "—"}\n` +
      `E-mail: ${lead.email}\n` +
      `Telefoon: ${lead.phone ?? "—"}\n` +
      `Bericht: ${lead.message ?? "—"}\n` +
      `Bron: ${lead.source ?? "—"}\n` +
      `Datum/tijd: ${now}\n`;

    const [confirmation, internal] = await Promise.all([
      sendEmail(RESEND_API_KEY, LOVABLE_API_KEY, {
        from: FROM_LEAD,
        to: [lead.email],
        reply_to: REPLY_TO,
        subject: "Bedankt voor uw aanvraag",
        html: confirmationHtml,
        text: confirmationText,
      }),
      sendEmail(RESEND_API_KEY, LOVABLE_API_KEY, {
        from: FROM_INTERNAL,
        to: [ADMIN_EMAIL],
        reply_to: lead.email,
        subject: "Nieuwe demo lead ontvangen",
        html: internalHtml,
        text: internalText,
      }),
    ]);

    if (!confirmation.ok) console.error("Confirmation send failed:", confirmation.status, confirmation.body);
    if (!internal.ok) console.error("Internal send failed:", internal.status, internal.body);

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
