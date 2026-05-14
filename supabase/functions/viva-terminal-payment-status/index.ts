// Poll the status of a Viva Cloud Terminal payment session.
// POST /functions/v1/viva-terminal-payment-status  { payment_id }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { vivaEnv, getVivaAccessToken, isVivaConfigured } from "../_shared/viva.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const TERMINAL_STATES = new Set(["paid", "failed", "cancelled", "expired"]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claims } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (!claims?.claims?.sub) return json({ error: "unauthorized" }, 401);
    const userId = claims.claims.sub as string;

    const { payment_id } = await req.json().catch(() => ({}));
    if (!payment_id) return json({ error: "payment_id_required" }, 400);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: payment, error } = await admin
      .from("payments")
      .select("*")
      .eq("id", payment_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return json({ error: "lookup_failed", detail: error.message }, 500);
    if (!payment) return json({ error: "not_found" }, 404);
    if (payment.method !== "terminal" || payment.provider !== "viva") {
      return json({ error: "not_a_terminal_payment" }, 400);
    }

    // If already terminal, return as-is (idempotent)
    if (payment.status === "paid") return json({ payment_id, status: "paid", terminal_status: "paid", paid_at: payment.paid_at });
    if (TERMINAL_STATES.has(payment.status)) return json({ payment_id, status: payment.status, terminal_status: payment.status });

    const meta = (payment.metadata || {}) as Record<string, any>;
    const sessionId = meta.session_id || payment.checkout_reference;
    const terminalId = meta.terminal_id;
    if (!sessionId || !terminalId) return json({ error: "missing_session_info" }, 400);

    let newStatus: string | null = null;
    let providerData: any = null;
    let providerError: string | null = null;

    if (isVivaConfigured()) {
      try {
        const token = await getVivaAccessToken();
        const env = vivaEnv();
        const url = `${env.api}/ecr/v1/sessions/${sessionId}?terminalId=${encodeURIComponent(terminalId)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        const text = await res.text();
        try { providerData = JSON.parse(text); } catch { providerData = { raw: text }; }
        if (res.status === 404) {
          // session not yet known to terminal — keep pending
        } else if (!res.ok) {
          providerError = `viva_status_http_${res.status}: ${text.slice(0, 300)}`;
        } else {
          // Viva ECR session response: success boolean + responseEventId/eventId
          const success = providerData?.success;
          const eventId = providerData?.eventId ?? providerData?.responseEventId;
          if (success === true) newStatus = "paid";
          else if (success === false) {
            const code = String(providerData?.errorCode ?? eventId ?? "");
            if (/cancel/i.test(JSON.stringify(providerData))) newStatus = "cancelled";
            else if (/expir|timeout/i.test(JSON.stringify(providerData))) newStatus = "expired";
            else newStatus = "failed";
          }
        }
      } catch (e) {
        providerError = `viva_status_exception: ${(e as Error).message}`;
      }
    } else {
      providerError = "viva_not_configured";
    }

    if (newStatus && payment.status !== "paid") {
      const updates: Record<string, any> = {
        status: newStatus,
        last_status_sync_at: new Date().toISOString(),
        metadata: {
          ...meta,
          terminal_status: newStatus,
          provider_status_payload: providerData,
          last_status_sync_at: new Date().toISOString(),
        },
      };
      if (newStatus === "paid") updates.paid_at = new Date().toISOString();
      if (newStatus === "failed" || newStatus === "cancelled" || newStatus === "expired") {
        updates.failure_reason = providerData?.message || providerData?.errorText || newStatus;
      }
      const { error: updErr } = await admin.from("payments").update(updates).eq("id", payment.id).neq("status", "paid");
      if (updErr) console.error("[viva-terminal-payment-status] update error", updErr);

      // Sync appointment payment_status
      if (payment.appointment_id) {
        const apptUpd: Record<string, any> = {};
        if (newStatus === "paid") apptUpd.payment_status = "paid";
        else if (newStatus === "failed" || newStatus === "cancelled" || newStatus === "expired") apptUpd.payment_status = "unpaid";
        if (Object.keys(apptUpd).length) {
          await admin.from("appointments").update(apptUpd).eq("id", payment.appointment_id).eq("user_id", userId);
        }
      }

      console.log(`[viva-terminal-payment-status] ${payment.id} -> ${newStatus}`);
    }

    return json({
      payment_id,
      status: newStatus || payment.status,
      terminal_status: newStatus || meta.terminal_status || "pending",
      provider_error: providerError,
    });
  } catch (e) {
    console.error("[viva-terminal-payment-status] error", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
