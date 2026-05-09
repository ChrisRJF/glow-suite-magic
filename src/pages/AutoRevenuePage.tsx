import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Clock, RotateCcw, Crown, Gift, CreditCard, ArrowRight, CheckCircle2, XCircle, Hourglass, Wallet, Circle } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useSettings, useCampaigns } from "@/hooks/useSupabaseData";
import { AutoRevenueEngine } from "@/components/AutoRevenueEngine";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";
import { autopilotStateKey } from "@/lib/demoIsolation";

type Range = "today" | "week" | "month";

function rangeStart(r: Range): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (r === "week") {
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
  } else if (r === "month") {
    d.setDate(1);
  }
  return d;
}

interface KPIs {
  revenue: number;
  filled: number;
  conversion: number;
  pending: number;
  paid: number;
  expired: number;
}

const EMPTY: KPIs = { revenue: 0, filled: 0, conversion: 0, pending: 0, paid: 0, expired: 0 };

interface FeedItem {
  id: string;
  ts: string;
  text: string;
  badge: "betaald" | "wacht op betaling" | "verlopen" | "bevestigd";
}

const BADGE_TONE: Record<FeedItem["badge"], string> = {
  betaald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
  "wacht op betaling": "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
  verlopen: "bg-muted text-muted-foreground border-border",
  bevestigd: "bg-primary/15 text-primary border-primary/30",
};

const MODULES = [
  { title: "Lege plekken vullen", desc: "Vul gaten in de agenda automatisch met klanten van je wachtlijst.", icon: Sparkles, to: "/wachtlijst", cta: "Openen" },
  { title: "Slimme wachtlijst", desc: "Klanten in de wachtrij krijgen direct een aanbod via WhatsApp.", icon: Clock, to: "/wachtlijst", cta: "Bekijken" },
  { title: "Klanten terughalen", desc: "Win klanten terug die al een tijdje niet zijn geweest.", icon: RotateCcw, to: "/herboekingen", cta: "Openen" },
  { title: "No-show recovery", desc: "Vraag automatisch een aanbetaling bij risicoklanten.", icon: Wallet, to: "/instellingen", cta: "Instellen" },
  { title: "Aanbetalingen", desc: "Bevestig boekingen pas na (deel)betaling — minder no-shows.", icon: CreditCard, to: "/instellingen", cta: "Instellen" },
  { title: "VIP winback", desc: "Beloon je beste klanten met een persoonlijk aanbod.", icon: Crown, to: "/marketing", cta: "Openen" },
  { title: "Verjaardag campagnes", desc: "Stuur automatisch een verjaardagsaanbod en boek extra omzet.", icon: Gift, to: "/marketing", cta: "Openen" },
];

export default function AutoRevenuePage() {
  const { user } = useAuth();
  const { demoMode } = useDemoMode();
  const { data: settingsRows } = useSettings();
  const { data: campaigns } = useCampaigns();
  const settings = settingsRows[0] as any | undefined;
  const [range, setRange] = useState<Range>("month");
  const [kpis, setKpis] = useState<KPIs>(EMPTY);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Auto Revenue (autopilot) on/off — reuses existing localStorage state.
  const [autopilotEnabled, setAutopilotEnabled] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(autopilotStateKey(demoMode));
      if (raw) return Boolean(JSON.parse(raw)?.enabled);
    } catch {}
    return false;
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem(autopilotStateKey(demoMode));
      setAutopilotEnabled(raw ? Boolean(JSON.parse(raw)?.enabled) : false);
    } catch {
      setAutopilotEnabled(false);
    }
  }, [demoMode]);

  const [mollieConnected, setMollieConnected] = useState(false);
  const [waitlistCount, setWaitlistCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ count: mollieCount }, { count: waitCount }] = await Promise.all([
        supabase.from("mollie_connections").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        supabase.from("waitlist_entries").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("is_demo", demoMode),
      ]);
      if (cancelled) return;
      setMollieConnected((mollieCount || 0) > 0);
      setWaitlistCount(waitCount || 0);
    })();
    return () => { cancelled = true; };
  }, [user, demoMode]);

  const whatsappEnabled = Boolean(settings?.whatsapp_enabled);
  const campaignsSent = (campaigns?.length || 0) > 0;

  const checklistItems = useMemo(() => ([
    { label: "WhatsApp gekoppeld", done: whatsappEnabled, to: "/whatsapp" },
    { label: "Betalingen ingesteld", done: mollieConnected, to: "/instellingen?section=payments" },
    { label: "Auto Revenue actief", done: autopilotEnabled, to: undefined },
    { label: "Eerste campagne verzonden", done: campaignsSent, to: "/marketing" },
  ]), [whatsappEnabled, mollieConnected, autopilotEnabled, campaignsSent]);
  const allReady = checklistItems.every((i) => i.done);

  const sinceIso = useMemo(() => rangeStart(range).toISOString(), [range]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const offersQ = supabase
          .from("auto_revenue_offers")
          .select("id, status, created_at, customer_name, service_name")
          .eq("user_id", user.id)
          .eq("is_demo", demoMode)
          .gte("created_at", sinceIso)
          .order("created_at", { ascending: false })
          .limit(50);

        const apptsQ = supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_demo", demoMode)
          .eq("status", "pending_payment");

        const paymentsQ = supabase
          .from("payments")
          .select("amount, metadata, status, paid_at")
          .eq("user_id", user.id)
          .eq("is_demo", demoMode)
          .eq("status", "paid")
          .gte("paid_at", sinceIso);

        const [offersRes, apptsRes, paymentsRes] = await Promise.all([offersQ, apptsQ, paymentsQ]);
        const offers = (offersRes.data as any[]) || [];
        const sent = offers.length;
        const paid = offers.filter((o) => o.status === "paid").length;
        const expired = offers.filter((o) => o.status === "expired").length;
        const pending = apptsRes.count || 0;
        const conversion = sent > 0 ? Math.round((paid / sent) * 100) : 0;

        const payments = (paymentsRes.data as any[]) || [];
        const revenue = payments
          .filter((p) => {
            const src = p?.metadata?.source;
            return src === "auto_revenue_deposit" || src === "auto_revenue_full";
          })
          .reduce((sum, p) => sum + Number(p.amount || 0), 0);

        // Build a friendly activity feed from the offers.
        const items: FeedItem[] = offers.slice(0, 12).map((o: any) => {
          const name = o.customer_name || "Een klant";
          const service = o.service_name ? ` (${o.service_name})` : "";
          let text = `${name} kreeg een aanbod${service}`;
          let badge: FeedItem["badge"] = "wacht op betaling";
          if (o.status === "paid") {
            text = `${name} boekte een vrijgekomen plek${service}`;
            badge = "betaald";
          } else if (o.status === "expired") {
            text = `Aanbod aan ${name} is verlopen`;
            badge = "verlopen";
          } else if (o.status === "pending_payment") {
            text = `${name} reageerde JA — wacht op betaling`;
            badge = "wacht op betaling";
          } else if (o.status === "sent") {
            text = `Aanbod verstuurd naar ${name}${service}`;
            badge = "bevestigd";
          }
          return { id: o.id, ts: o.created_at, text, badge };
        });

        if (!cancelled) {
          setKpis({ revenue, filled: paid, conversion, pending, paid, expired });
          setFeed(items);
        }
      } catch (err) {
        console.warn("AutoRevenuePage load failed", err);
        if (!cancelled) {
          setKpis(EMPTY);
          setFeed([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, demoMode, sinceIso]);

  const kpiCards = [
    { label: "Extra omzet deze maand", value: formatEuro(kpis.revenue), tone: "from-emerald-500/15 to-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400" },
    { label: "Lege plekken gevuld", value: kpis.filled, tone: "from-primary/15 to-primary/5 border-primary/20 text-primary" },
    { label: "Conversie", value: `${kpis.conversion}%`, tone: "from-primary/15 to-primary/5 border-primary/20 text-primary" },
    { label: "Wacht op betaling", value: kpis.pending, tone: "from-amber-500/15 to-amber-500/5 border-amber-500/20 text-amber-700 dark:text-amber-400" },
    { label: "Betaalde boekingen", value: kpis.paid, tone: "from-emerald-500/15 to-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-400" },
    { label: "Verlopen aanbiedingen", value: kpis.expired, tone: "from-muted to-muted/30 border-border text-muted-foreground" },
  ];

  const rangeToggle = (
    <div className="inline-flex rounded-xl border border-border bg-card p-0.5 text-xs">
      {(["today", "week", "month"] as Range[]).map((r) => (
        <button
          key={r}
          onClick={() => setRange(r)}
          className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
            range === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {r === "today" ? "Vandaag" : r === "week" ? "Week" : "Maand"}
        </button>
      ))}
    </div>
  );

  return (
    <AppLayout
      title="🔥 Auto Revenue"
      subtitle="Laat GlowSuite automatisch lege plekken vullen en omzet terugwinnen."
      actions={rangeToggle}
    >
      <div className="space-y-6">
        {/* Hero CTA */}
        <Card className="overflow-hidden border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent">
          <CardContent className="p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
              <div className="max-w-xl">
                <Badge variant="outline" className="mb-3 border-primary/30 bg-primary/10 text-primary">
                  <Sparkles className="w-3 h-3 mr-1" /> AI-aangedreven omzet
                </Badge>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
                  Laat GlowSuite automatisch je lege plekken vullen.
                </h2>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                  Wachtlijst, no-show recovery, klanten terughalen en aanbetalingen — in één systeem. Eén keer activeren, daarna draait het op de achtergrond.
                </p>
              </div>
              <div className="flex flex-col sm:flex-row lg:flex-col gap-2 lg:items-end shrink-0">
                <Button asChild variant="outline" size="lg">
                  <Link to="/instellingen?section=auto-revenue">Instellingen</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <AutoRevenueEngine source="auto-revenue" />

        {/* Live status strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <StatusPill tone={autopilotEnabled ? "green" : "yellow"} label={autopilotEnabled ? "Auto Revenue zoekt naar lege plekken…" : "Auto Revenue staat uit"} />
          <StatusPill tone={waitlistCount > 0 ? "green" : "muted"} label={waitlistCount > 0 ? `${waitlistCount} klanten op de wachtlijst` : "Wachtlijst leeg"} />
          <StatusPill tone={mollieConnected ? "green" : "yellow"} label={mollieConnected ? "Aanbetalingen actief" : "Aanbetalingen niet ingesteld"} />
          <StatusPill tone={whatsappEnabled ? "green" : "red"} label={whatsappEnabled ? "WhatsApp verbonden" : "WhatsApp niet verbonden"} />
        </div>

        {/* Quick start checklist */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <CardTitle className="text-lg">Klaar om te starten</CardTitle>
                <CardDescription>Vier korte stappen voor maximaal resultaat.</CardDescription>
              </div>
              {allReady && (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">🎉 Volledig actief</Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {checklistItems.map((item) => {
                const Inner = (
                  <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors ${item.done ? "border-emerald-500/30 bg-emerald-500/5" : "border-border bg-card hover:border-primary/40"}`}>
                    {item.done ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
                    )}
                    <span className={`text-sm ${item.done ? "text-foreground" : "text-muted-foreground"}`}>{item.label}</span>
                    {!item.done && item.to && <ArrowRight className="w-3.5 h-3.5 text-muted-foreground ml-auto" />}
                  </div>
                );
                return (
                  <li key={item.label}>
                    {item.to && !item.done ? <Link to={item.to}>{Inner}</Link> : Inner}
                  </li>
                );
              })}
            </ul>
            {allReady && (
              <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400 font-medium">
                🎉 GlowSuite vult nu automatisch lege plekken voor je.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Onboarding empty state when no activity yet */}
        {!loading && feed.length === 0 && !autopilotEnabled && (
          <Card className="border-dashed">
            <CardContent className="p-6">
              <h3 className="font-semibold text-base">GlowSuite kan automatisch:</h3>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>• lege plekken vullen</li>
                <li>• klanten terughalen</li>
                <li>• no-shows verminderen</li>
                <li>• omzet verhogen</li>
              </ul>
              <p className="text-sm mt-3">Gebruik de Omzet Autopilot hierboven om te beginnen.</p>
            </CardContent>
          </Card>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {kpiCards.map((c) => (
            <div key={c.label} className={`rounded-2xl border p-3 bg-gradient-to-br ${c.tone}`}>
              <p className="text-[10px] uppercase tracking-wider font-medium opacity-80">{c.label}</p>
              <p className="text-xl sm:text-2xl font-semibold tabular-nums mt-1 text-foreground">
                {loading ? "…" : c.value}
              </p>
            </div>
          ))}
        </div>

        {/* Live activity */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-lg">Live activiteit</CardTitle>
                <CardDescription>Wat Auto Revenue de afgelopen periode voor je deed.</CardDescription>
              </div>
              <Badge variant="outline" className="text-[10px]">{demoMode ? "Demo data" : "Live"}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            {feed.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Nog geen activiteit in deze periode. Zodra Auto Revenue plekken vult, verschijnen ze hier.
              </div>
            ) : (
              <ul className="divide-y divide-border -mx-2">
                {feed.map((item) => {
                  const Icon = item.badge === "betaald" ? CheckCircle2 : item.badge === "verlopen" ? XCircle : item.badge === "wacht op betaling" ? Hourglass : Sparkles;
                  return (
                    <li key={item.id} className="flex items-center gap-3 py-3 px-2">
                      <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate">{item.text}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(item.ts).toLocaleString("nl-NL", { dateStyle: "short", timeStyle: "short" })}
                        </p>
                      </div>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${BADGE_TONE[item.badge]}`}>
                        {item.badge}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Modules grid */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Modules</h2>
            <p className="text-xs text-muted-foreground">Alle manieren waarop Auto Revenue extra omzet binnenhaalt.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {MODULES.map((m) => {
              const Icon = m.icon;
              return (
                <Card key={m.title} className="hover:border-primary/40 transition-colors">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                        <Icon className="w-5 h-5" />
                      </div>
                      <Badge variant="outline" className="text-[10px]">Actief</Badge>
                    </div>
                    <h3 className="font-semibold mt-3">{m.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{m.desc}</p>
                    <Link to={m.to} className="inline-flex items-center gap-1.5 text-xs font-medium text-primary mt-3 hover:underline">
                      {m.cta} <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        {/* Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Auto Revenue instellingen</CardTitle>
            <CardDescription>
              Bepaal hoe Auto Revenue je klanten benadert. Je kunt alle instellingen op één plek beheren.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <SettingTile title="Bevestiging" desc="Geen / aanbetaling / volledige betaling" />
              <SettingTile title="Reservering" desc="Hoe lang een plek vastgehouden wordt" />
              <SettingTile title="WhatsApp limiet" desc="Maximaal aantal berichten per dag" />
              <SettingTile title="Korting limiet" desc="Maximaal kortingspercentage" />
              <SettingTile title="Stille uren" desc="Wanneer Auto Revenue niet stuurt" />
              <SettingTile title="Bericht voorbeelden" desc="Bekijk en pas je templates aan" />
            </div>
            <div className="mt-4">
              <Button asChild>
                <Link to="/instellingen?section=auto-revenue">Instellingen openen</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

function SettingTile({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border p-4 bg-card/40">
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}

function StatusPill({ tone, label }: { tone: "green" | "yellow" | "red" | "muted"; label: string }) {
  const tones: Record<string, string> = {
    green: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    yellow: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30",
    red: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30",
    muted: "bg-muted text-muted-foreground border-border",
  };
  const dot: Record<string, string> = {
    green: "bg-emerald-500",
    yellow: "bg-amber-500",
    red: "bg-red-500",
    muted: "bg-muted-foreground/40",
  };
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${tones[tone]}`}>
      <span className={`h-2 w-2 rounded-full shrink-0 ${tone === "green" ? "animate-pulse" : ""} ${dot[tone]}`} />
      <span className="truncate">{label}</span>
    </div>
  );
}
