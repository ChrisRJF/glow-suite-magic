// Send migration help request: confirmation to requester + internal mail to support.
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
const SUPPORT_EMAIL = "support@glowsuite.nl";
const FROM_INTERNAL = "GlowSuite Overstap <overstap@email.glowsuite.nl>";

interface Payload {
  name: string;
  email: string;
  phone?: string | null;
  salon_name?: string | null;
  current_system?: string | null;
  message?: string | null;
  source?: string | null;
}

async function sendEmail(
  apiKey: string,
  lovableKey: string,
  payload: Record<string, unknown>,
) {
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

    const data: Payload = await req.json();
    if (!data?.email || !data?.name) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const now = new Date().toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" });

    const confirmationHtml = renderGlowSuiteEmail({
      title: "We hebben je overstap aanvraag ontvangen",
      preheader: "Een GlowSuite specialist neemt binnen 1 werkdag contact op om je overstap rustig door te nemen.",
      eyebrow: "Overstap hulp",
      heading: "Je aanvraag voor overstap hulp is binnen",
      intro:
        "Bedankt voor je interesse in GlowSuite. We nemen binnen 1 werkdag persoonlijk contact op om je huidige situatie door te nemen en de overstap rustig te plannen.",
      helper: "Geen actie nodig, je hoort snel van ons.",
      footerReason: "demo",
    });

    const confirmationText =
      "Je aanvraag voor overstap hulp is binnen.\n\n" +
      "We nemen binnen 1 werkdag contact op om je huidige situatie door te nemen en de overstap rustig te plannen.\n\n" +
      "Team GlowSuite";

    const rows: Array<[string, string]> = [
      ["Naam", data.name],
      ["Salonnaam", data.salon_name ?? "—"],
      ["E-mail", data.email],
      ["Telefoon", data.phone ?? "—"],
      ["Huidig systeem", data.current_system ?? "—"],
      ["Toelichting", data.message ?? "—"],
      ["Bron", data.source ?? "—"],
      ["Datum/tijd", now],
    ];
    const tableRows = rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:6px 12px 6px 0;font-size:13px;color:#64748b;vertical-align:top;width:140px;">${esc(k)}</td><td style="padding:6px 0;font-size:14px;color:#0f172a;white-space:pre-wrap;">${esc(String(v))}</td></tr>`,
      )
      .join("");
    const internalHtml = renderGlowSuiteEmail({
      title: "Overstap hulp aanvraag",
      preheader: `Nieuwe overstap aanvraag: ${data.name}${data.salon_name ? " · " + data.salon_name : ""}`,
      eyebrow: "Overstap hulp",
      heading: "Overstap hulp aanvraag",
      intro: "Er is zojuist een nieuwe aanvraag voor overstap hulp binnengekomen.",
      bodyHtml: softCardHtml(
        `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;">${tableRows}</table>`,
      ),
      ctaLabel: "Antwoord aanvrager",
      ctaUrl: `mailto:${data.email}`,
      footerNote: "Interne notificatie · verstuurd door GlowSuite Overstap.",
      footerText: "Interne notificatie · niet voor externe verzending.",
    });

    const internalText =
      `Overstap hulp aanvraag\n\n` +
      rows.map(([k, v]) => `${k}: ${v}`).join("\n");

    const [confirmation, internal] = await Promise.all([
      sendEmail(RESEND_API_KEY, LOVABLE_API_KEY, {
        from: GLOWSUITE_FROM,
        to: [data.email],
        reply_to: GLOWSUITE_REPLY_TO,
        subject: "We hebben je overstap aanvraag ontvangen",
        html: confirmationHtml,
        text: confirmationText,
      }),
      sendEmail(RESEND_API_KEY, LOVABLE_API_KEY, {
        from: FROM_INTERNAL,
        to: [SUPPORT_EMAIL],
        reply_to: data.email,
        subject: "Overstap hulp aanvraag",
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
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("send-migration-help error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
