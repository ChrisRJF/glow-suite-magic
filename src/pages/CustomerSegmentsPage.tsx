import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCustomerIntelligence, type CustomerIntelligence } from "@/hooks/useCustomerIntelligence";
import { formatEuro } from "@/lib/data";
import {
  Crown,
  AlertTriangle,
  UserCheck,
  Euro,
  Snowflake,
  Gift,
  TrendingUp,
  Heart,
  Calendar,
  Sparkles,
  Send,
  ArrowRight,
  Users,
  CalendarX,
  Download,
} from "lucide-react";
import { cn } from "@/lib/utils";

const SEGMENT_META: Record<
  string,
  { icon: typeof Crown; tone: "primary" | "warning" | "success" | "destructive" | "info"; route: string; cta: string }
> = {
  vip: { icon: Crown, tone: "warning", route: "/marketing", cta: "Beloon VIP's" },
  churn: { icon: AlertTriangle, tone: "destructive", route: "/marketing", cta: "Win-back sturen" },
  noshow: { icon: CalendarX, tone: "warning", route: "/whatsapp", cta: "Herinnering sturen" },
  new: { icon: UserCheck, tone: "primary", route: "/whatsapp", cta: "Welkom sturen" },
  top: { icon: Euro, tone: "success", route: "/marketing", cta: "Premium aanbod" },
  reactivate: { icon: Snowflake, tone: "info", route: "/marketing", cta: "Heractiveer" },
  membership: { icon: Gift, tone: "success", route: "/abonnementen", cta: "Bied membership" },
  upsell: { icon: TrendingUp, tone: "primary", route: "/marketing", cta: "Upsell campagne" },
  loyal: { icon: Heart, tone: "primary", route: "/marketing", cta: "Loyalty actie" },
};

const TONE_STYLES: Record<string, { border: string; bg: string; icon: string; text: string }> = {
  primary: {
    border: "border-primary/20",
    bg: "bg-primary/[0.04]",
    icon: "bg-primary/15 text-primary",
    text: "text-primary",
  },
  warning: {
    border: "border-warning/30",
    bg: "bg-warning/[0.05]",
    icon: "bg-warning/20 text-warning",
    text: "text-warning",
  },
  success: {
    border: "border-emerald-500/25",
    bg: "bg-emerald-500/[0.05]",
    icon: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  destructive: {
    border: "border-destructive/25",
    bg: "bg-destructive/[0.05]",
    icon: "bg-destructive/15 text-destructive",
    text: "text-destructive",
  },
  info: {
    border: "border-sky-500/25",
    bg: "bg-sky-500/[0.05]",
    icon: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
    text: "text-sky-600 dark:text-sky-400",
  },
};

export default function CustomerSegmentsPage() {
  const { segments, intelligence, loading } = useCustomerIntelligence();
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const navigate = useNavigate();

  const active = useMemo(
    () => segments.find((s) => s.key === activeKey) || null,
    [segments, activeKey]
  );

  const totalPotential = useMemo(
    () => segments.reduce((s, g) => s + g.potential, 0),
    [segments]
  );

  return (
    <AppLayout title="AI Segmenten">
      <div className="-mt-2 sm:-mt-1 pb-[max(env(safe-area-inset-bottom),1rem)] space-y-5">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-fuchsia-500/[0.05] to-transparent p-4">
          <div className="absolute -top-8 -right-8 h-28 w-28 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
          <div className="flex items-start gap-3 relative">
            <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-primary to-fuchsia-500 text-white flex items-center justify-center shrink-0 shadow-sm">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg sm:text-xl font-semibold leading-tight">AI klant­segmenten</h2>
              <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                Automatisch gegenereerd op basis van bezoekgedrag, omzet en risico.
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg bg-background/60 border border-border">
                  <Users className="w-3 h-3" />
                  {intelligence.length} klanten
                </span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-1 rounded-lg bg-background/60 border border-border">
                  <Euro className="w-3 h-3" />
                  {formatEuro(totalPotential)} potentieel
                </span>
              </div>
            </div>
          </div>
        </div>

        {loading && (
          <p className="text-sm text-muted-foreground text-center py-8">Segmenten laden…</p>
        )}

        {/* Segment grid */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
          {segments.map((seg) => {
            const meta = SEGMENT_META[seg.key];
            const styles = TONE_STYLES[meta.tone];
            const Icon = meta.icon;
            const isActive = activeKey === seg.key;
            return (
              <button
                key={seg.key}
                onClick={() => setActiveKey(isActive ? null : seg.key)}
                className={cn(
                  "relative text-left rounded-2xl border p-3.5 transition-all",
                  styles.border,
                  styles.bg,
                  "hover:shadow-sm active:scale-[0.99]",
                  isActive && "ring-2 ring-primary/30"
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div className={cn("h-8 w-8 rounded-lg flex items-center justify-center shrink-0", styles.icon)}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold leading-tight">{seg.label}</p>
                    <p className="text-[10.5px] text-muted-foreground mt-0.5 leading-snug">
                      {seg.description}
                    </p>
                  </div>
                  <span className={cn("text-lg font-bold tabular-nums", styles.text)}>{seg.items.length}</span>
                </div>
                <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-border/50">
                  <span className="text-[10px] text-muted-foreground">Potentieel</span>
                  <span className="text-xs font-semibold tabular-nums">{formatEuro(seg.potential)}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Active segment detail */}
        {active && <SegmentDetail segmentKey={active.key} label={active.label} items={active.items} potential={active.potential} />}
      </div>
    </AppLayout>
  );
}

function SegmentDetail({
  segmentKey,
  label,
  items,
  potential,
}: {
  segmentKey: string;
  label: string;
  items: CustomerIntelligence[];
  potential: number;
}) {
  const navigate = useNavigate();
  const meta = SEGMENT_META[segmentKey];
  const styles = TONE_STYLES[meta.tone];

  const top = useMemo(
    () => [...items].sort((a, b) => b.lifetimeValue - a.lifetimeValue).slice(0, 50),
    [items]
  );

  const avgChurn = items.length
    ? Math.round(items.reduce((s, i) => s + i.churnRisk, 0) / items.length)
    : 0;
  const avgLtv = items.length
    ? Math.round(items.reduce((s, i) => s + i.lifetimeValue, 0) / items.length)
    : 0;

  const recommendedAction =
    segmentKey === "churn"
      ? "Win-back WhatsApp + 15% korting"
      : segmentKey === "vip"
      ? "Persoonlijke VIP-actie of vroege toegang"
      : segmentKey === "noshow"
      ? "Verplichte aanbetaling + extra herinnering"
      : segmentKey === "new"
      ? "Welkomstreeks van 3 berichten"
      : segmentKey === "top"
      ? "Premium upsell of cadeaubon"
      : segmentKey === "reactivate"
      ? "Heractivatiecampagne met aanbod"
      : segmentKey === "membership"
      ? "Membership voorstel op maat"
      : segmentKey === "upsell"
      ? "Aanvullende behandeling voorstellen"
      : "Loyalty beloning";

  const handleExport = () => {
    const header = ["Naam", "Telefoon", "Email", "LTV", "Bezoeken", "Laatste (d)", "ChurnRisk", "NoShowRisk", "Loyalty", "Tags"];
    const rows = items.map((i) => [
      i.customer.name,
      i.customer.phone || "",
      i.customer.email || "",
      i.lifetimeValue.toFixed(2),
      String(i.totalVisits),
      i.lastVisitDaysAgo < 999 ? String(i.lastVisitDaysAgo) : "",
      String(i.churnRisk),
      String(i.noShowRisk),
      String(i.loyaltyScore),
      i.aiTags.join("|"),
    ]);
    const escape = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map((r) => r.map(escape).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `segment-${segmentKey}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{label}</p>
          <p className="text-[11px] text-muted-foreground">
            {items.length} klanten · {formatEuro(potential)} potentieel
          </p>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-border bg-secondary/40 p-2.5">
          <p className="text-[10px] text-muted-foreground">Potentieel</p>
          <p className="text-sm font-semibold tabular-nums">{formatEuro(potential)}</p>
        </div>
        <div className="rounded-xl border border-border bg-secondary/40 p-2.5">
          <p className="text-[10px] text-muted-foreground">Gem. LTV</p>
          <p className="text-sm font-semibold tabular-nums">{formatEuro(avgLtv)}</p>
        </div>
        <div className="rounded-xl border border-border bg-secondary/40 p-2.5">
          <p className="text-[10px] text-muted-foreground">Gem. churn</p>
          <p className={cn("text-sm font-semibold tabular-nums", avgChurn >= 60 ? "text-destructive" : avgChurn >= 30 ? "text-warning" : "text-foreground")}>
            {avgChurn}
          </p>
        </div>
      </div>

      {/* Recommended bulk action */}
      <div className={cn("rounded-xl border p-3", styles.border, styles.bg)}>
        <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-0.5">
          Aanbevolen bulk-actie
        </p>
        <p className="text-xs font-medium leading-snug">{recommendedAction}</p>
      </div>

      {/* Bulk CTAs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Button
          size="sm"
          variant="gradient"
          className="h-9 text-xs w-full"
          onClick={() => navigate(`/marketing?segment=${segmentKey}`)}
          disabled={items.length === 0}
        >
          <Sparkles className="w-3.5 h-3.5" /> Campagne maken
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 text-xs w-full"
          onClick={() => navigate(`/whatsapp?segment=${segmentKey}`)}
          disabled={items.length === 0}
        >
          <Send className="w-3.5 h-3.5" /> WhatsApp lijst
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-9 text-xs w-full"
          onClick={handleExport}
          disabled={items.length === 0}
        >
          <Download className="w-3.5 h-3.5" /> Exporteer CSV
        </Button>
      </div>

      {/* Klantenlijst */}
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-6">Nog geen klanten in dit segment.</p>
      ) : (
        <div className="space-y-1.5 max-h-[60vh] overflow-y-auto -mx-1 px-1">
          {top.map((i) => (
            <button
              key={i.customer.id}
              onClick={() => navigate(`/klanten?customer=${i.customer.id}`)}
              className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-secondary/40 hover:bg-secondary border border-transparent hover:border-border transition text-left"
            >
              <div className="w-8 h-8 rounded-full gradient-bg flex items-center justify-center shrink-0">
                <span className="text-[10px] font-semibold text-primary-foreground">
                  {i.customer.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .substring(0, 2)
                    .toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{i.customer.name}</p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {i.totalVisits} bezoeken · {i.lastVisitDaysAgo < 999 ? `${i.lastVisitDaysAgo}d geleden` : "nog geen bezoek"}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-semibold tabular-nums">{formatEuro(i.lifetimeValue)}</p>
                <p className="text-[10px] text-muted-foreground truncate max-w-[80px]">{i.aiTags[0] || "—"}</p>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
