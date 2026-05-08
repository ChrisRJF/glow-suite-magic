import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Flame, Sparkles, Clock, Users, RotateCcw, Crown, Gift, CreditCard, ArrowRight, CheckCircle2, XCircle, Hourglass, Wallet } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useDemoMode } from "@/hooks/useDemoMode";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";

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
  const [range, setRange] = useState<Range>("month");
  const [kpis, setKpis] = useState<KPIs>(EMPTY);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(false);

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

  return (
    <AppLayout>
      <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Hero */}
        <div className="rounded-3xl border border-border bg-gradient-to-br from-primary/10 via-background to-background p-6 sm:p-8">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-2xl bg-primary/15 text-primary flex items-center justify-center">
                <Flame className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Auto Revenue</h1>
                <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                  Laat GlowSuite automatisch lege plekken vullen en omzet terugwinnen.
                </p>
              </div>
            </div>
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
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6">
            {kpiCards.map((c) => (
              <div key={c.label} className={`rounded-2xl border p-3 bg-gradient-to-br ${c.tone}`}>
                <p className="text-[10px] uppercase tracking-wider font-medium opacity-80">{c.label}</p>
                <p className="text-xl sm:text-2xl font-semibold tabular-nums mt-1 text-foreground">
                  {loading ? "…" : c.value}
                </p>
              </div>
            ))}
          </div>
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
