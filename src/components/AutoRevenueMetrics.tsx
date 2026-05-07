import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";
import { Send, MessageSquare, Clock, CheckCircle2, XCircle, Percent, TrendingUp } from "lucide-react";

type Range = "today" | "week" | "month";

const REPLY_REGEX = /\b(ja|yes|ok|graag|doe maar)\b/i;

function rangeStart(r: Range): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (r === "week") {
    const day = (d.getDay() + 6) % 7; // Monday-start
    d.setDate(d.getDate() - day);
  } else if (r === "month") {
    d.setDate(1);
  }
  return d;
}

interface Metrics {
  sent: number;
  replies: number;
  pending: number;
  paid: number;
  expired: number;
  conversion: number;
  revenue: number;
}

const EMPTY: Metrics = { sent: 0, replies: 0, pending: 0, paid: 0, expired: 0, conversion: 0, revenue: 0 };

export function AutoRevenueMetrics() {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const [range, setRange] = useState<Range>("today");
  const [metrics, setMetrics] = useState<Metrics>(EMPTY);
  const [loading, setLoading] = useState(false);

  const sinceIso = useMemo(() => rangeStart(range).toISOString(), [range]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const baseOffers = supabase
          .from("auto_revenue_offers")
          .select("status")
          .eq("user_id", user.id)
          .eq("is_demo", demoMode)
          .gte("created_at", sinceIso);

        const baseInbound = supabase
          .from("whatsapp_inbound_messages" as any)
          .select("body")
          .eq("user_id", user.id)
          .eq("is_demo", demoMode)
          .gte("received_at", sinceIso);

        const baseAppts = supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_demo", demoMode)
          .eq("status", "pending_payment");

        const basePayments = supabase
          .from("payments")
          .select("amount, metadata, status, paid_at")
          .eq("user_id", user.id)
          .eq("is_demo", demoMode)
          .eq("status", "paid")
          .gte("paid_at", sinceIso);

        const [offersRes, inboundRes, apptsRes, paymentsRes] = await Promise.all([
          baseOffers,
          baseInbound,
          baseAppts,
          basePayments,
        ]);

        const offers = (offersRes.data as any[]) || [];
        const sent = offers.length;
        const paid = offers.filter((o) => o.status === "paid").length;
        const expired = offers.filter((o) => o.status === "expired").length;

        const inbound = (inboundRes.data as any[]) || [];
        const replies = inbound.filter((m) => REPLY_REGEX.test(String(m.body || ""))).length;

        const pending = apptsRes.count || 0;

        const payments = (paymentsRes.data as any[]) || [];
        const revenue = payments
          .filter((p) => {
            const src = p?.metadata?.source;
            return src === "auto_revenue_deposit" || src === "auto_revenue_full";
          })
          .reduce((sum, p) => sum + Number(p.amount || 0), 0);

        const conversion = sent > 0 ? Math.round((paid / sent) * 100) : 0;

        if (!cancelled) {
          setMetrics({ sent, replies, pending, paid, expired, conversion, revenue });
        }
      } catch (err) {
        console.warn("AutoRevenueMetrics load failed", err);
        if (!cancelled) setMetrics(EMPTY);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, demoMode, sinceIso]);

  const cards = [
    { label: "Verstuurd", value: metrics.sent, icon: Send, tone: "text-primary bg-primary/10 border-primary/20" },
    { label: "Reacties", value: metrics.replies, icon: MessageSquare, tone: "text-primary bg-primary/10 border-primary/20" },
    { label: "Wacht op betaling", value: metrics.pending, icon: Clock, tone: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
    { label: "Betaald", value: metrics.paid, icon: CheckCircle2, tone: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
    { label: "Verlopen", value: metrics.expired, icon: XCircle, tone: "text-muted-foreground bg-muted border-border" },
    { label: "Conversie", value: `${metrics.conversion}%`, icon: Percent, tone: "text-primary bg-primary/10 border-primary/20" },
    { label: "Omzet via Autopilot", value: formatEuro(metrics.revenue), icon: TrendingUp, tone: "text-success bg-success/10 border-success/20" },
  ];

  return (
    <div className="p-4 rounded-xl bg-secondary/40 border border-border mb-3">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div>
          <p className="text-sm font-semibold">Auto Revenue conversie</p>
          <p className="text-[11px] text-muted-foreground">Dit laat zien hoeveel omzet Auto Revenue automatisch terugwint.</p>
        </div>
        <div className="inline-flex rounded-lg border border-border bg-background p-0.5 text-[11px]">
          {(["today", "week", "month"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                range === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r === "today" ? "Vandaag" : r === "week" ? "Deze week" : "Deze maand"}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mt-3">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className={`p-2.5 rounded-xl border ${c.tone}`}>
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className="w-3 h-3" />
                <span className="text-[10px] uppercase tracking-wider font-medium opacity-80">{c.label}</span>
              </div>
              <p className="text-base font-semibold tabular-nums">{loading ? "…" : c.value}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
