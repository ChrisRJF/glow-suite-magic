import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

const PENDING_KEY = "glowsuite_pending_leads";
const LAST_RUN_KEY = "glowsuite_lead_automation_last_run";

export interface PendingLeadIntent {
  name?: string;
  email?: string;
  phone?: string;
  service?: string;
  intent_time?: string;
  capturedAt: string;
}

/** Public helper — usable from non-authenticated routes (e.g. /boeken). */
export function queueLeadIntent(intent: Omit<PendingLeadIntent, "capturedAt">) {
  try {
    if (!intent.name && !intent.email && !intent.phone) return;
    const list: PendingLeadIntent[] = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
    // Dedupe on contact within last hour
    const key = (intent.email || intent.phone || intent.name || "").toLowerCase();
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recent = list.find(
      (l) => (l.email || l.phone || l.name || "").toLowerCase() === key && new Date(l.capturedAt).getTime() > oneHourAgo
    );
    if (recent) return;
    list.push({ ...intent, capturedAt: new Date().toISOString() });
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-50)));
  } catch {/* ignore */}
}

/** Mark a lead as 'geboekt' when its contact matches a completed booking. */
export async function markLeadAsBooked(userId: string, contact: { email?: string; phone?: string; name?: string }) {
  try {
    const filters: string[] = [];
    if (contact.email) filters.push(`email.eq.${contact.email}`);
    if (contact.phone) filters.push(`phone.eq.${contact.phone}`);
    if (filters.length === 0) return;
    const { data } = await supabase
      .from("leads")
      .select("id,status")
      .eq("user_id", userId)
      .or(filters.join(","))
      .neq("status", "geboekt")
      .neq("status", "klant_geworden");
    if (data && data.length > 0) {
      await supabase
        .from("leads")
        .update({ status: "geboekt", followed_up_at: new Date().toISOString() })
        .in("id", data.map((l) => l.id));
    }
  } catch {/* ignore */}
}

/** Global hook: flushes pending intents and runs follow-up sequence. */
export function useLeadAutomation() {
  const { user } = useAuth();
  const ranRef = useRef(false);

  useEffect(() => {
    if (!user || ranRef.current) return;
    ranRef.current = true;

    const run = async () => {
      // Throttle: only run once every 10 minutes
      const lastRun = Number(localStorage.getItem(LAST_RUN_KEY) || "0");
      if (Date.now() - lastRun < 10 * 60 * 1000) return;
      localStorage.setItem(LAST_RUN_KEY, String(Date.now()));

      // 1. Flush pending lead intents → insert as leads
      try {
        const pending: PendingLeadIntent[] = JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
        if (pending.length > 0) {
          const rows = pending
            .filter((p) => p.name || p.email || p.phone)
            .map((p) => ({
              user_id: user.id,
              name: p.name || p.email || p.phone || "Onbekend",
              email: p.email || "",
              phone: p.phone || "",
              source: "boekflow_afgebroken",
              status: "nieuw",
              notes: [
                p.service ? `Geïnteresseerd in: ${p.service}` : null,
                p.intent_time ? `Voorkeurstijd: ${p.intent_time}` : null,
                `Afgebroken op ${new Date(p.capturedAt).toLocaleString("nl-NL")}`,
              ].filter(Boolean).join(" · "),
            }));
          if (rows.length > 0) {
            const { error } = await supabase.from("leads").insert(rows);
            if (!error) localStorage.removeItem(PENDING_KEY);
          }
        }
      } catch {/* ignore */}

      // 2. Follow-up sequence: run on existing leads
      try {
        const { data: leads } = await supabase
          .from("leads")
          .select("*")
          .eq("user_id", user.id)
          .in("status", ["nieuw", "opgevolgd"]);

        if (!leads) return;
        const now = Date.now();

        for (const lead of leads) {
          const created = new Date(lead.created_at).getTime();
          const ageHours = (now - created) / (1000 * 60 * 60);
          const notes = lead.notes || "";

          // Step 1: 1h reminder
          if (ageHours >= 1 && !notes.includes("[AUTO-1H]")) {
            await supabase.from("leads").update({
              notes: `${notes}\n[AUTO-1H ${new Date().toLocaleString("nl-NL")}] Herinnering verstuurd`.trim(),
              followed_up_at: new Date().toISOString(),
              status: "opgevolgd",
            }).eq("id", lead.id);
          }
          // Step 2: 24h booking link
          else if (ageHours >= 24 && !notes.includes("[AUTO-24H]")) {
            await supabase.from("leads").update({
              notes: `${notes}\n[AUTO-24H ${new Date().toLocaleString("nl-NL")}] Boekingslink verstuurd`.trim(),
              followed_up_at: new Date().toISOString(),
              status: "opgevolgd",
            }).eq("id", lead.id);
          }
          // Step 3: 3-day discount
          else if (ageHours >= 72 && !notes.includes("[AUTO-3D]")) {
            await supabase.from("leads").update({
              notes: `${notes}\n[AUTO-3D ${new Date().toLocaleString("nl-NL")}] 10% korting aangeboden`.trim(),
              followed_up_at: new Date().toISOString(),
              status: "opgevolgd",
            }).eq("id", lead.id);
          }
          // Mark stale (>14 days, still no booking) as verloren
          else if (ageHours >= 14 * 24 && lead.status !== "geboekt" && !notes.includes("[AUTO-LOST]")) {
            await supabase.from("leads").update({
              notes: `${notes}\n[AUTO-LOST] Geen reactie na 14 dagen`.trim(),
              status: "verloren",
            }).eq("id", lead.id);
          }
        }
      } catch {/* ignore */}
    };

    run();
  }, [user]);
}
