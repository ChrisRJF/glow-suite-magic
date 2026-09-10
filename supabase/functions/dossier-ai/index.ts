// Klantdossier P4.5 — on-demand AI summaries.
//
// Actions (staff JWT required, dossier content permission required):
//   dossier_summary   -> administrative summary of one customer dossier
//   appointment_prep  -> administrative preparation for one appointment
//   record_summary    -> short summary of one treatment record
//
// Rules enforced here:
// - only called on explicit user action (no scheduler, no background job)
// - tenant + permissions resolved server-side, never trusted from the client
// - only minimal dossier facts are sent to the model: no ids, tokens, urls,
//   email, phone, address or payment data
// - the model may never diagnose, advise treatment or judge medical safety
// - nothing is written back to the dossier

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Ctx {
  tenantId: string;
  actorId: string;
}

async function resolveContext(req: Request): Promise<Ctx | null> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return null;
  const [{ data: tenantId }, { data: mayContent }] = await Promise.all([
    userClient.rpc("current_tenant_id"),
    userClient.rpc("can_view_dossier_content"),
  ]);
  if (!tenantId || mayContent !== true) return null;
  return { tenantId: String(tenantId), actorId: userData.user.id };
}

const nl = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("nl-NL", { day: "2-digit", month: "short", year: "numeric" }) : "onbekend";

/** Strips anything that could carry identifiers, links or contact data. */
function safeText(value: unknown, max = 400): string {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value.join(", ") : String(value ?? "");
  return raw
    .replace(/https?:\/\/\S+/g, "[link verwijderd]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[contact verwijderd]")
    .replace(/\+?\d[\d\s-]{7,}\d/g, "[contact verwijderd]")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

async function buildDossierFacts(ctx: Ctx, customerId: string, appointmentId?: string | null) {
  const [customer, appts, reqs, templates, records, journeys, alerts, consents, services] = await Promise.all([
    admin.from("customers").select("id").eq("id", customerId).eq("user_id", ctx.tenantId).maybeSingle(),
    admin
      .from("appointments")
      .select("id, appointment_date, status, service_id, journey_id, journey_session_number")
      .eq("customer_id", customerId)
      .eq("user_id", ctx.tenantId)
      .order("appointment_date", { ascending: false })
      .limit(10),
    admin
      .from("form_requests")
      .select("template_id, status, completed_at, valid_until")
      .eq("customer_id", customerId)
      .eq("user_id", ctx.tenantId)
      .order("created_at", { ascending: false })
      .limit(10),
    admin.from("form_templates").select("id, title").eq("user_id", ctx.tenantId),
    admin
      .from("treatment_records")
      .select("status, completed_at, service_id")
      .eq("customer_id", customerId)
      .eq("user_id", ctx.tenantId)
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("treatment_journeys")
      .select("name, status, planned_sessions")
      .eq("customer_id", customerId)
      .eq("user_id", ctx.tenantId)
      .limit(5),
    admin
      .from("customer_alerts")
      .select("label, review_status")
      .eq("customer_id", customerId)
      .eq("user_id", ctx.tenantId)
      .limit(10),
    admin
      .from("customer_consents")
      .select("consent_type, event, occurred_at")
      .eq("customer_id", customerId)
      .eq("user_id", ctx.tenantId)
      .order("seq", { ascending: false })
      .limit(10),
    admin.from("services").select("id, name").eq("user_id", ctx.tenantId),
  ]);

  if (!customer.data) return null;

  const serviceName = (id: string | null) =>
    safeText((services.data || []).find((s: { id: string; name: string }) => s.id === id)?.name || "Behandeling", 60);
  const titleById = new Map(((templates.data as { id: string; title: string }[]) || []).map((t) => [t.id, t.title]));

  const lines: string[] = [];
  const appointments = (appts.data as { id: string; appointment_date: string; status: string; service_id: string | null; journey_session_number: number | null }[]) || [];
  const past = appointments.filter((a) => new Date(a.appointment_date) <= new Date());
  const future = appointments.filter((a) => new Date(a.appointment_date) > new Date());

  lines.push(
    `Recente afspraken: ${past.slice(0, 3).map((a) => `${serviceName(a.service_id)} op ${nl(a.appointment_date)} (${safeText(a.status, 30)})`).join("; ") || "geen"}`,
  );
  lines.push(
    `Volgende afspraak: ${future.length ? `${serviceName(future[future.length - 1].service_id)} op ${nl(future[future.length - 1].appointment_date)}` : "niet gepland"}`,
  );
  lines.push(
    `Formulieren: ${((reqs.data as { template_id: string; status: string; completed_at: string | null; valid_until: string | null }[]) || [])
      .slice(0, 5)
      .map((r) => `${safeText(titleById.get(r.template_id) || "Formulier", 60)}: ${safeText(r.status, 30)}${r.valid_until ? `, geldig tot ${nl(r.valid_until)}` : ""}`)
      .join("; ") || "geen"}`,
  );
  lines.push(
    `Toestemmingen: ${((consents.data as { consent_type: string; event: string; occurred_at: string }[]) || [])
      .slice(0, 5)
      .map((c) => `${safeText(c.consent_type, 40)}: ${safeText(c.event, 20)} (${nl(c.occurred_at)})`)
      .join("; ") || "niet vastgelegd"}`,
  );
  lines.push(
    `Behandelverslagen: ${((records.data as { status: string; completed_at: string | null; service_id: string | null }[]) || [])
      .slice(0, 3)
      .map((r) => `${serviceName(r.service_id)}: ${safeText(r.status, 20)}${r.completed_at ? ` op ${nl(r.completed_at)}` : ""}`)
      .join("; ") || "geen"}`,
  );
  lines.push(
    `Behandeltraject: ${((journeys.data as { name: string; status: string; planned_sessions: number | null }[]) || [])
      .map((j) => `${safeText(j.name, 60)} (${safeText(j.status, 30)}, ${j.planned_sessions ?? "?"} sessies gepland)`)
      .join("; ") || "geen"}`,
  );
  const alertRows = (alerts.data as { label: string | null; review_status: string }[]) || [];
  lines.push(
    `Administratieve aandachtspunten: ${alertRows.filter((a) => a.review_status !== "reviewed").map((a) => safeText(a.label || "aandachtspunt", 80)).join("; ") || "geen open punten"}`,
  );

  if (appointmentId) {
    const focus = appointments.find((a) => a.id === appointmentId);
    if (focus) {
      lines.unshift(
        `Betreffende afspraak: ${serviceName(focus.service_id)} op ${nl(focus.appointment_date)} (status ${safeText(focus.status, 30)}${focus.journey_session_number ? `, sessie ${focus.journey_session_number}` : ""})`,
      );
    }
  }

  return lines.join("\n");
}

async function buildRecordFacts(ctx: Ctx, recordId: string) {
  const { data } = await admin
    .from("treatment_records")
    .select("values, template_snapshot, status, completed_at")
    .eq("id", recordId)
    .eq("user_id", ctx.tenantId)
    .maybeSingle();
  if (!data) return null;
  const fields = ((data.template_snapshot as { fields?: { key: string; label: string; type: string }[] } | null)?.fields) || [];
  const values = (data.values as Record<string, unknown>) || {};
  const lines = fields
    .filter((f) => f.type !== "info_text")
    .map((f) => `${safeText(f.label, 80)}: ${safeText(values[f.key], 600) || "niet ingevuld"}`);
  lines.unshift(`Status verslag: ${safeText(data.status, 20)}${data.completed_at ? ` (afgerond ${nl(data.completed_at)})` : ""}`);
  return lines.join("\n");
}

const SYSTEM = [
  "Je bent een administratieve assistent binnen een salon- en kliniekagenda.",
  "Je vat uitsluitend samen wat letterlijk in de aangeleverde dossiergegevens staat.",
  "Verboden: diagnose stellen, behandeladvies geven, medische geschiktheid of contra-indicaties beoordelen,",
  "of zeggen dat een behandeling veilig of onveilig is. Doe geen aannames en verzin niets.",
  "Antwoord in het Nederlands, in maximaal 7 korte bullets, zonder kopjes en zonder lange zinnen.",
  "Gebruik geen gedachtestreepjes in de tekst.",
].join(" ");

async function summarise(prompt: string): Promise<{ text?: string; status?: number; error?: string }> {
  if (!LOVABLE_API_KEY) return { status: 500, error: "missing_key" };
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Lovable-API-Key": LOVABLE_API_KEY,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      instructions: SYSTEM,
      input: prompt,
      stream: true,
      reasoning: { effort: "low" },
    }),
  });

  if (!res.ok || !res.body) {
    return { status: res.status, error: `gateway_${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") text += evt.delta;
      } catch {
        // ignore keep-alive fragments
      }
    }
  }
  return { text: text.trim() };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const ctx = await resolveContext(req);
    if (!ctx) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const customerId = body.customer_id ? String(body.customer_id) : null;

    let facts: string | null = null;
    let task = "";

    if (action === "dossier_summary" && customerId) {
      facts = await buildDossierFacts(ctx, customerId);
      task = "Vat dit dossier administratief samen en noem de openstaande administratieve acties.";
    } else if (action === "appointment_prep" && customerId) {
      facts = await buildDossierFacts(ctx, customerId, body.appointment_id ? String(body.appointment_id) : null);
      task = "Vat administratief samen wat relevant is als voorbereiding op de betreffende afspraak.";
    } else if (action === "record_summary" && body.record_id) {
      facts = await buildRecordFacts(ctx, String(body.record_id));
      task = "Vat dit behandelverslag samen in maximaal 5 korte punten, alleen op basis van de inhoud hieronder.";
    } else {
      return json({ error: "invalid_request" }, 400);
    }

    if (!facts) return json({ error: "not_found" }, 404);

    const result = await summarise(`${task}\n\nGegevens:\n${facts}`);
    if (result.error || !result.text) {
      const status = result.status === 429 || result.status === 402 ? result.status : 502;
      return json({ error: result.error || "empty_response" }, status);
    }

    await admin.from("audit_logs").insert({
      user_id: ctx.tenantId,
      actor_user_id: ctx.actorId,
      action: `dossier_ai_${action}`,
      target_type: "customer",
      target_id: customerId,
      details: { action },
    });

    return json({ summary: result.text });
  } catch (_e) {
    // No dossier content in logs.
    return json({ error: "unavailable" }, 500);
  }
});
