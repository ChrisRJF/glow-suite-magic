/**
 * Shared Omzet Autopilot runner — single source of truth for "Nu uitvoeren".
 *
 * Used by:
 *   - AutoRevenueEngine (Dashboard "Omzet Autopilot" overview card)
 *   - AutoRevenuePage   (🔥 Auto Revenue page primary button)
 *
 * No new backend logic. Mirrors the previous in-component implementation so
 * the same DB writes (autopilot_runs, autopilot_decisions, autopilot_action_logs,
 * campaigns, discounts, rebook_actions) are produced from both call sites.
 *
 * Demo mode never sends real WhatsApp / never inserts campaigns/discounts.
 */
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import {
  useCustomers,
  useAppointments,
  useCampaigns,
  useServices,
} from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";
import { simulateDemoAction } from "@/lib/demoMode";
import {
  pickTopSlots,
  rankCustomers,
  buildActionMessage,
  ACTION_LABELS,
  type ScoredSlot,
  type AutopilotAction,
} from "@/lib/autopilotScoring";

export interface RunnerLogEntry {
  type: "campaign" | "discount" | "rebook" | "demo";
  description: string;
  result: string;
  revenue: number;
}

export interface UseAutoRevenueRunnerOptions {
  /** Settings from the autopilot config (defaults match getAutopilotState). */
  maxDiscount?: number;
  maxMessagesPerDay?: number;
  /** Optional UI logger — engine card animates these. Page does not need it. */
  onLog?: (entry: RunnerLogEntry) => void;
}

export interface UseAutoRevenueRunnerResult {
  running: boolean;
  runAutopilot: () => Promise<void>;
  scoredDecisions: ScoredSlot[];
  projectedExtraRevenue: number;
  rankedCustomers: ReturnType<typeof rankCustomers>;
  emptySlots: number;
  avgServicePrice: number;
  todaysAppts: any[];
  inactiveCustomers: any[];
}

const TOTAL_SLOTS = 10;

export function useAutoRevenueRunner(
  opts: UseAutoRevenueRunnerOptions = {},
): UseAutoRevenueRunnerResult {
  const maxDiscount = opts.maxDiscount ?? 15;
  const maxMessagesPerDay = opts.maxMessagesPerDay ?? 10;

  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const { data: customers } = useCustomers();
  const { data: appointments } = useAppointments();
  const { data: campaigns, refetch: refetchCampaigns } = useCampaigns();
  const { data: services } = useServices();
  const { insert: insertCampaign } = useCrud("campaigns");
  const { insert: insertDiscount } = useCrud("discounts");
  const { insert: insertRebook } = useCrud("rebook_actions");

  const [running, setRunning] = useState(false);
  void campaigns;

  const todayStr = new Date().toISOString().split("T")[0];

  const todaysAppts = useMemo(
    () =>
      appointments.filter(
        (a: any) =>
          a.appointment_date?.startsWith(todayStr) && a.status !== "geannuleerd",
      ),
    [appointments, todayStr],
  );

  const emptySlots = Math.max(0, TOTAL_SLOTS - todaysAppts.length);

  const avgServicePrice = useMemo(() => {
    const prices = services
      .map((s: any) => Number(s.price) || 0)
      .filter((p) => p > 0);
    if (prices.length === 0) return 55;
    return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  }, [services]);

  const scoredDecisions = useMemo<ScoredSlot[]>(() => {
    const now = new Date();
    const busyHours = new Set(
      todaysAppts
        .map((a: any) => {
          const t =
            a.start_time ||
            (a.appointment_date
              ? new Date(a.appointment_date).toTimeString().slice(0, 5)
              : null);
          return t ? Number(t.split(":")[0]) : null;
        })
        .filter((h: number | null): h is number => h != null),
    );
    const slots: { startsAt: Date; expectedRevenue: number }[] = [];
    for (let h = 9; h <= 18; h++) {
      if (busyHours.has(h)) continue;
      const d = new Date(now);
      d.setHours(h, 0, 0, 0);
      if (d.getTime() < now.getTime() - 3_600_000) continue;
      slots.push({ startsAt: d, expectedRevenue: avgServicePrice });
    }
    return pickTopSlots(slots, 5, now);
  }, [todaysAppts, avgServicePrice]);

  const projectedExtraRevenue = useMemo(
    () => scoredDecisions.reduce((s, d) => s + d.projectedRevenue, 0),
    [scoredDecisions],
  );

  const rankedCustomers = useMemo(() => {
    const signals = customers.map((c: any) => {
      const last = appointments
        .filter((a: any) => a.customer_id === c.id && a.status !== "geannuleerd")
        .sort(
          (a: any, b: any) =>
            new Date(b.appointment_date).getTime() -
            new Date(a.appointment_date).getTime(),
        )[0];
      return {
        id: c.id,
        name: c.name,
        total_spent: c.total_spent,
        no_show_count: c.no_show_count,
        lastVisitAt: last ? new Date(last.appointment_date) : null,
      };
    });
    return rankCustomers(signals);
  }, [customers, appointments]);

  const inactiveCustomers = useMemo(
    () =>
      customers.filter((c: any) => {
        const last = appointments
          .filter((a: any) => a.customer_id === c.id && a.status !== "geannuleerd")
          .sort(
            (a: any, b: any) =>
              new Date(b.appointment_date).getTime() -
              new Date(a.appointment_date).getTime(),
          )[0];
        if (!last) return true;
        return (
          (Date.now() - new Date(last.appointment_date).getTime()) /
            (1000 * 60 * 60 * 24) >
          30
        );
      }),
    [customers, appointments],
  );

  const log = (entry: RunnerLogEntry) => {
    opts.onLog?.(entry);
  };

  const runAutopilot = useCallback(async () => {
    if (!user || running) return;
    setRunning(true);

    const expectedTotal = scoredDecisions.reduce(
      (s, d) => s + d.projectedRevenue,
      0,
    );
    let runId: string | null = null;
    try {
      const { data: runRow } = await supabase
        .from("autopilot_runs")
        .insert({
          user_id: user.id,
          run_type: demoMode ? "demo" : "manual",
          status: demoMode ? "simulated" : "executed",
          started_at: new Date().toISOString(),
          expected_revenue_cents: Math.round(expectedTotal * 100),
          actions_count: 0,
          is_demo: demoMode,
        })
        .select("id")
        .single();
      runId = (runRow as any)?.id ?? null;

      if (runId && scoredDecisions.length > 0) {
        await supabase.from("autopilot_decisions").insert(
          scoredDecisions.map((d) => ({
            user_id: user.id,
            run_id: runId,
            slot_date: d.startsAt.toISOString().slice(0, 10),
            slot_time: d.startsAt.toTimeString().slice(0, 8),
            action: d.action,
            score: Number(d.score.toFixed(2)),
            fill_probability: Number(d.fillProbability.toFixed(3)),
            expected_revenue_cents: Math.round(d.projectedRevenue * 100),
            urgency_multiplier: Number(d.urgencyMultiplier.toFixed(2)),
            reason: d.reason,
            status: demoMode ? "simulated" : "suggested",
            is_demo: demoMode,
          })) as any,
        );
      }
    } catch (e) {
      console.warn("autopilot run logging failed", e);
    }

    if (demoMode) {
      simulateDemoAction("Omzet Autopilot scoring", {
        decisions: scoredDecisions.length,
        projected: projectedExtraRevenue,
      });
      if (scoredDecisions.length === 0) {
        log({
          type: "demo",
          description:
            "Geen winstgevende lege plekken gevonden — geen actie",
          result: "Skipped",
          revenue: 0,
        });
      }
      for (const d of scoredDecisions) {
        log({
          type: "demo",
          description: `${ACTION_LABELS[d.action]} · ${d.startsAt.toLocaleTimeString(
            "nl-NL",
            { hour: "2-digit", minute: "2-digit" },
          )} — ${d.reason}`,
          result: `Score ${d.score.toFixed(0)}`,
          revenue: d.projectedRevenue,
        });
      }
      if (runId) {
        await supabase
          .from("autopilot_runs")
          .update({
            finished_at: new Date().toISOString(),
            actions_count: scoredDecisions.length,
            actual_revenue_cents: 0,
          })
          .eq("id", runId);
      }
      setRunning(false);
      return;
    }

    let actionsRun = 0;
    let actualRevenue = 0;
    const errors: string[] = [];
    const bookingLink = `${window.location.origin}/boek`;

    let whatsappEnabled = false;
    try {
      const { data: ws } = await supabase
        .from("whatsapp_settings")
        .select("enabled")
        .eq("user_id", user.id)
        .maybeSingle();
      whatsappEnabled = Boolean((ws as any)?.enabled);
    } catch (e) {
      console.warn("whatsapp_settings lookup failed", e);
    }

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    let messagedTodayIds = new Set<string>();
    try {
      const { data: logs } = await supabase
        .from("autopilot_action_logs")
        .select("customer_id")
        .eq("user_id", user.id)
        .eq("is_demo", false)
        .gte("created_at", todayStart.toISOString());
      messagedTodayIds = new Set(
        (logs || [])
          .map((l: any) => l.customer_id)
          .filter((id: string | null): id is string => Boolean(id)),
      );
    } catch (e) {
      console.warn("autopilot dedupe lookup failed", e);
    }

    try {
      if (scoredDecisions.length === 0) {
        toast("Geen winstgevende lege plekken vandaag — geen actie 👍");
        setRunning(false);
        return;
      }

      if (!whatsappEnabled) {
        toast.warning(
          "WhatsApp is uitgeschakeld — autopilot heeft geen berichten verstuurd.",
          {
            description:
              "Schakel WhatsApp in via Instellingen om autopilot acties uit te voeren.",
          },
        );
        setRunning(false);
        return;
      }

      const grouped: Record<AutopilotAction, ScoredSlot[]> = {
        waitlist_offer: [],
        whatsapp_blast: [],
        discount_offer: [],
        do_nothing: [],
      };
      for (const d of scoredDecisions) grouped[d.action].push(d);

      const validIds = new Set(customers.map((c: any) => c.id));
      const topTargets = rankedCustomers
        .map((rc) => rc.customer)
        .filter(
          (c) => validIds.has(c.id) && !messagedTodayIds.has(c.id),
        )
        .slice(0, Math.max(1, maxMessagesPerDay));

      for (const action of [
        "waitlist_offer",
        "whatsapp_blast",
        "discount_offer",
      ] as AutopilotAction[]) {
        const decisions = grouped[action];
        if (decisions.length === 0) continue;

        const avgHours =
          decisions.reduce((s, d) => s + d.hoursUntil, 0) / decisions.length;
        const projected = decisions.reduce(
          (s, d) => s + d.projectedRevenue,
          0,
        );
        const message = buildActionMessage(action, {
          hoursUntil: avgHours,
          bookingLink,
          discountPct: maxDiscount,
        });

        if (action === "discount_offer" && maxDiscount > 0) {
          const disc = await insertDiscount({
            title: `Auto: ${maxDiscount}% korting (lage vulkans)`,
            type: "percentage",
            value: maxDiscount,
            is_active: true,
          });
          if (disc) {
            actionsRun++;
            log({
              type: "discount",
              description: `Korting actie · ${decisions.length} plek(ken) · ${decisions[0].reason}`,
              result: `Verwacht +${formatEuro(projected)}`,
              revenue: 0,
            });
          } else {
            errors.push("korting kon niet worden aangemaakt");
          }
        }

        const audience =
          action === "waitlist_offer"
            ? `Wachtlijst (${decisions.length} plek)`
            : `${topTargets.length} top klanten`;

        const result = await insertCampaign({
          title: `Auto: ${ACTION_LABELS[action]} - ${new Date().toLocaleDateString("nl-NL")}`,
          type: "whatsapp",
          status: "verzonden",
          audience,
          sent_count:
            action === "waitlist_offer"
              ? decisions.length
              : topTargets.length,
          message,
        });

        if (!result) {
          errors.push(`${ACTION_LABELS[action]} campagne mislukt`);
          continue;
        }

        actionsRun++;
        actualRevenue += projected;
        log({
          type: action === "waitlist_offer" ? "rebook" : "campaign",
          description: `${ACTION_LABELS[action]} · ${decisions.length} plek(ken) · ${decisions[0].reason}`,
          result: `Score ${decisions[0].score.toFixed(0)}`,
          revenue: projected,
        });

        if (action === "whatsapp_blast") {
          for (const c of topTargets.slice(0, decisions.length)) {
            const r = await insertRebook({
              customer_id: c.id,
              status: "verzonden",
              suggested_date: new Date(
                Date.now() + 86_400_000,
              ).toISOString(),
            });
            if (!r) errors.push(`rebook voor ${c.name || c.id} mislukt`);
            if (runId) {
              try {
                await supabase.from("autopilot_action_logs").insert({
                  user_id: user.id,
                  run_id: runId,
                  customer_id: c.id,
                  action,
                  status: r ? "executed" : "failed",
                  message,
                  expected_revenue_cents: Math.round(
                    (decisions[0]?.projectedRevenue || 0) * 100,
                  ),
                  is_demo: false,
                } as any);
                messagedTodayIds.add(c.id);
              } catch (err) {
                console.warn("autopilot action log insert failed", err);
              }
            }
          }
        }
      }

      await refetchCampaigns();

      if (actionsRun === 0 && errors.length === 0) {
        toast("Geen actie nodig — agenda ziet er goed uit 👍");
      } else if (errors.length === 0) {
        toast.success(
          `Autopilot uitgevoerd — verwachte omzet +${formatEuro(actualRevenue)} 🚀`,
        );
      } else if (actionsRun > 0) {
        toast.warning(`Autopilot deels gelukt (${actionsRun} actie(s))`, {
          description: errors.join(" · "),
        });
      } else {
        toast.error("Autopilot kon geen acties uitvoeren", {
          description: errors.join(" · "),
        });
      }
    } catch (e) {
      console.error("Autopilot error", e);
      toast.error("Autopilot kon niet alles uitvoeren — probeer het opnieuw.");
    } finally {
      if (runId) {
        try {
          await supabase
            .from("autopilot_runs")
            .update({
              finished_at: new Date().toISOString(),
              actions_count: actionsRun,
              actual_revenue_cents: Math.round(actualRevenue * 100),
              status: actionsRun > 0 ? "executed" : "failed",
            })
            .eq("id", runId);
        } catch (err) {
          console.warn("autopilot run finalize failed", err);
        }
      }
      setRunning(false);
    }
  }, [
    user,
    running,
    demoMode,
    scoredDecisions,
    projectedExtraRevenue,
    rankedCustomers,
    customers,
    maxDiscount,
    maxMessagesPerDay,
    insertCampaign,
    insertDiscount,
    insertRebook,
    refetchCampaigns,
  ]);

  return {
    running,
    runAutopilot,
    scoredDecisions,
    projectedExtraRevenue,
    rankedCustomers,
    emptySlots,
    avgServicePrice,
    todaysAppts,
    inactiveCustomers,
  };
}
