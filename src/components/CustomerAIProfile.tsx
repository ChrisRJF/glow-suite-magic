import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { formatEuro } from "@/lib/data";
import {
  Sparkles,
  TrendingUp,
  AlertTriangle,
  Heart,
  Calendar,
  Send,
  Star,
  Gift,
  MessageCircle,
  Activity,
  ArrowRight,
  CheckCircle2,
  Clock,
  Euro,
} from "lucide-react";
import type { CustomerIntelligence } from "@/hooks/useCustomerIntelligence";
import { cn } from "@/lib/utils";

const DAYS_NL = ["zo", "ma", "di", "wo", "do", "vr", "za"];

function ScorePill({
  label,
  value,
  icon: Icon,
  tone = "primary",
  invert = false,
}: {
  label: string;
  value: number;
  icon: typeof Heart;
  tone?: "primary" | "warning" | "destructive" | "success";
  invert?: boolean;
}) {
  // for invert (risk), high = bad
  const effective = invert ? value : value;
  const colorTone =
    invert && effective >= 60
      ? "destructive"
      : invert && effective >= 30
      ? "warning"
      : !invert && effective >= 70
      ? "success"
      : !invert && effective <= 30
      ? "warning"
      : tone;
  const styles = {
    primary: "bg-primary/10 text-primary border-primary/20",
    warning: "bg-warning/10 text-warning border-warning/20",
    destructive: "bg-destructive/10 text-destructive border-destructive/20",
    success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
  }[colorTone];
  return (
    <div className={cn("rounded-xl border p-2.5 flex flex-col gap-1", styles)}>
      <div className="flex items-center justify-between">
        <Icon className="w-3.5 h-3.5 opacity-80" />
        <span className="text-[10px] font-semibold opacity-80">{value}</span>
      </div>
      <p className="text-[10px] leading-tight font-medium">{label}</p>
      <div className="h-1 rounded-full bg-current/10 overflow-hidden">
        <div className="h-full bg-current rounded-full transition-all" style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

interface Recommendation {
  id: string;
  title: string;
  reason: string;
  confidence: number;
  impact: string;
  icon: typeof Sparkles;
  cta: string;
  route: string;
  tone: "primary" | "warning" | "success" | "destructive";
}

function buildRecommendations(i: CustomerIntelligence, customerId: string): Recommendation[] {
  const recs: Recommendation[] = [];
  const route = (path: string) => `${path}?customer=${customerId}`;

  if (i.churnRisk >= 60) {
    recs.push({
      id: "reactivate",
      title: "Stuur heractivatiecampagne",
      reason: `Klant is ${i.lastVisitDaysAgo}d geleden geweest — hoge afhaakkans.`,
      confidence: Math.min(95, 60 + Math.round(i.churnRisk / 4)),
      impact: `+${formatEuro(i.avgSpend)} per terugkomst`,
      icon: Sparkles,
      cta: "Win-back sturen",
      route: route("/marketing"),
      tone: "destructive",
    });
  }
  if (i.aiTags.includes("Follow-up needed")) {
    recs.push({
      id: "followup",
      title: "Boek follow-up binnen 14 dagen",
      reason: i.avgCycleDays
        ? `Gemiddelde cyclus ${i.avgCycleDays}d — klant is klaar voor herboeking.`
        : `Klaar voor volgende afspraak.`,
      confidence: Math.round(i.rebookingLikelihood),
      impact: `+${formatEuro(i.avgSpend)}`,
      icon: Calendar,
      cta: "Plan afspraak",
      route: route("/agenda"),
      tone: "primary",
    });
  }
  if (i.aiTags.includes("Membership candidate")) {
    recs.push({
      id: "membership",
      title: "Bied membership aan",
      reason: `${i.totalVisits} bezoeken in cyclus van ${i.avgCycleDays}d — ideale kandidaat.`,
      confidence: 78,
      impact: `+${formatEuro(i.avgSpend * 3)} jaar`,
      icon: Gift,
      cta: "Open abonnementen",
      route: route("/abonnementen"),
      tone: "success",
    });
  }
  if (i.aiTags.includes("Upsell candidate") && i.preferredServiceName) {
    recs.push({
      id: "upsell",
      title: `Upsell op ${i.preferredServiceName}`,
      reason: `Klant boekt vaak ${i.preferredServiceName} — kans op aanvullende behandeling.`,
      confidence: 64,
      impact: `+${formatEuro(Math.round(i.avgSpend * 0.4))}`,
      icon: TrendingUp,
      cta: "Stuur voorstel",
      route: route("/marketing"),
      tone: "primary",
    });
  }
  if (i.aiTags.includes("Review candidate")) {
    recs.push({
      id: "review",
      title: "Vraag review",
      reason: `Recente afspraak — perfect moment voor 5-sterren beoordeling.`,
      confidence: 71,
      impact: `+social proof`,
      icon: Star,
      cta: "Review vragen",
      route: route("/whatsapp"),
      tone: "success",
    });
  }
  if (i.noShowRisk >= 40) {
    recs.push({
      id: "reminder",
      title: "Stuur extra herinnering",
      reason: `No-show risico ${i.noShowRisk}/100 — bevestiging beperkt schade.`,
      confidence: 80,
      impact: `-€${Math.round(i.avgSpend)} verlies`,
      icon: AlertTriangle,
      cta: "WhatsApp sturen",
      route: route("/whatsapp"),
      tone: "warning",
    });
  }
  return recs.slice(0, 4);
}

interface Props {
  intel: CustomerIntelligence;
}

export function CustomerAIProfile({ intel }: Props) {
  const navigate = useNavigate();
  const c = intel.customer;

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (intel.preferredDays.length > 0 && intel.preferredTimeSlot) {
      parts.push(
        `bezoekt meestal op ${intel.preferredDays.map((d) => DAYS_NL[d]).join("/")} in de ${intel.preferredTimeSlot}`
      );
    } else if (intel.preferredTimeSlot) {
      parts.push(`boekt graag in de ${intel.preferredTimeSlot}`);
    }
    if (intel.avgSpend > 0) parts.push(`besteedt gemiddeld ${formatEuro(intel.avgSpend)}`);
    if (intel.predictedNextVisitDate) {
      const d = new Date(intel.predictedNextVisitDate);
      const days = Math.max(0, Math.round((d.getTime() - Date.now()) / 86400000));
      if (days < 60)
        parts.push(
          `verwachte terugkomst binnen ~${days}d (${d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" })})`
        );
    }
    if (parts.length === 0) {
      return intel.totalVisits === 0
        ? "Nieuwe klant — nog geen patroon zichtbaar. Eerste indruk telt."
        : "Patroon nog in opbouw — verzamel meer data voor betere voorspellingen.";
    }
    return `Deze klant ${parts.join(", ")}.`;
  }, [intel]);

  const recommendations = useMemo(() => buildRecommendations(intel, c.id), [intel, c.id]);

  return (
    <div className="space-y-4">
      {/* AI Summary */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-fuchsia-500/[0.05] to-transparent p-3.5">
        <div className="absolute -top-6 -right-6 h-20 w-20 rounded-full bg-primary/15 blur-2xl pointer-events-none" />
        <div className="flex items-start gap-2.5 relative">
          <div className="h-7 w-7 shrink-0 rounded-lg bg-gradient-to-br from-primary to-fuchsia-500 text-white flex items-center justify-center shadow-sm">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-primary/80 mb-0.5">
              AI samenvatting
            </p>
            <p className="text-xs leading-relaxed text-foreground">{summary}</p>
          </div>
        </div>
        {intel.aiTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2.5 relative">
            {intel.aiTags.slice(0, 5).map((t) => (
              <span
                key={t}
                className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md bg-background/70 border border-border text-foreground/80"
              >
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Health Pills */}
      <div>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
          AI Health
        </p>
        <div className="grid grid-cols-3 gap-1.5">
          <ScorePill label="Loyalty" value={intel.loyaltyScore} icon={Heart} tone="primary" />
          <ScorePill label="Churn" value={intel.churnRisk} icon={AlertTriangle} invert tone="destructive" />
          <ScorePill label="Spend" value={intel.spendingScore} icon={Euro} tone="success" />
          <ScorePill label="Engage" value={intel.campaignEngagement} icon={MessageCircle} tone="primary" />
          <ScorePill label="Attend" value={intel.attendanceScore} icon={CheckCircle2} tone="success" />
          <ScorePill label="Rebook" value={intel.rebookingLikelihood} icon={Activity} tone="primary" />
        </div>
      </div>

      {/* Revenue Insights */}
      <div className="rounded-2xl border border-border bg-secondary/40 p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Revenue
          </p>
          <span
            className={cn(
              "text-[10px] font-semibold inline-flex items-center gap-1",
              intel.retentionTrend === "up" && "text-emerald-600 dark:text-emerald-400",
              intel.retentionTrend === "down" && "text-destructive",
              intel.retentionTrend === "flat" && "text-muted-foreground"
            )}
          >
            <TrendingUp
              className={cn(
                "w-3 h-3",
                intel.retentionTrend === "down" && "rotate-180"
              )}
            />
            {intel.retentionTrend === "up" ? "groei" : intel.retentionTrend === "down" ? "daling" : "stabiel"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-base font-bold tabular-nums">{formatEuro(intel.lifetimeValue)}</p>
            <p className="text-[10px] text-muted-foreground">Lifetime value</p>
          </div>
          <div>
            <p className="text-base font-bold tabular-nums">{formatEuro(intel.estimatedAnnualValue)}</p>
            <p className="text-[10px] text-muted-foreground">Per jaar (geschat)</p>
          </div>
          <div>
            <p className="text-sm font-semibold tabular-nums">
              {intel.avgCycleDays > 0 ? `${intel.avgCycleDays}d` : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground">Bezoekcyclus</p>
          </div>
          <div>
            <p className="text-sm font-semibold capitalize">{intel.bestMonth || "—"}</p>
            <p className="text-[10px] text-muted-foreground">Beste maand</p>
          </div>
        </div>
      </div>

      {/* AI Recommendations */}
      {recommendations.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
            AI Aanbevelingen
          </p>
          <div className="space-y-2">
            {recommendations.map((r) => {
              const toneClasses = {
                primary: "border-primary/20 bg-primary/[0.04]",
                warning: "border-warning/30 bg-warning/[0.05]",
                success: "border-emerald-500/25 bg-emerald-500/[0.05]",
                destructive: "border-destructive/25 bg-destructive/[0.05]",
              }[r.tone];
              const iconBg = {
                primary: "bg-primary/15 text-primary",
                warning: "bg-warning/20 text-warning",
                success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
                destructive: "bg-destructive/15 text-destructive",
              }[r.tone];
              return (
                <div key={r.id} className={cn("rounded-xl border p-2.5", toneClasses)}>
                  <div className="flex items-start gap-2.5">
                    <div className={cn("h-7 w-7 rounded-lg flex items-center justify-center shrink-0", iconBg)}>
                      <r.icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold leading-tight">{r.title}</p>
                      <p className="text-[10.5px] text-muted-foreground mt-0.5 leading-snug">{r.reason}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded-md bg-background/70 border border-border">
                          {r.confidence}% confidence
                        </span>
                        <span className="text-[9.5px] font-medium text-muted-foreground">{r.impact}</span>
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-8 text-xs mt-2"
                    onClick={() => navigate(r.route)}
                  >
                    <r.icon className="w-3 h-3" /> {r.cta}
                    <ArrowRight className="w-3 h-3 ml-auto" />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Timeline */}
      {intel.appointments.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">
            Tijdlijn
          </p>
          <div className="space-y-1.5">
            {intel.appointments.slice(0, 6).map((a) => {
              const d = new Date(a.appointment_date);
              const isPast = d.getTime() < Date.now();
              const tone =
                a.status === "geannuleerd"
                  ? "destructive"
                  : a.status === "no-show"
                  ? "warning"
                  : !isPast
                  ? "primary"
                  : "success";
              const toneDot = {
                primary: "bg-primary",
                warning: "bg-warning",
                success: "bg-emerald-500",
                destructive: "bg-destructive",
              }[tone];
              return (
                <div
                  key={a.id}
                  className="flex items-center gap-2.5 p-2 rounded-lg bg-secondary/40 border border-border/60"
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", toneDot)} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-medium truncate">
                      {d.toLocaleDateString("nl-NL", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                      {a.start_time ? ` · ${a.start_time.slice(0, 5)}` : ""}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate capitalize">{a.status}</p>
                  </div>
                  <span className="text-[11px] font-semibold tabular-nums">
                    {formatEuro(Number(a.price) || 0)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick AI Actions */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button
          variant="outline"
          size="sm"
          className="h-9 text-xs"
          onClick={() => navigate(`/whatsapp?customer=${c.id}`)}
        >
          <Send className="w-3.5 h-3.5" /> WhatsApp
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 text-xs"
          onClick={() => navigate(`/agenda?customer=${c.id}`)}
        >
          <Calendar className="w-3.5 h-3.5" /> Plan
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 text-xs"
          onClick={() => navigate(`/marketing?customer=${c.id}`)}
        >
          <Sparkles className="w-3.5 h-3.5" /> Campagne
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-9 text-xs"
          onClick={() => navigate(`/automatiseringen?customer=${c.id}`)}
        >
          <Clock className="w-3.5 h-3.5" /> Follow-up
        </Button>
      </div>
    </div>
  );
}
