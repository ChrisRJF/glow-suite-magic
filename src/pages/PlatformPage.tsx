import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ShieldAlert, Building2, Info } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  currentPeriod, formatCents, lastPeriods, periodLabel, platformErrorMessage, statusLabel, sumFinance,
  type FinanceRow,
} from "@/lib/platformMetrics";

type Salon = {
  tenant_id: string; salon_name: string; created_at: string; is_demo: boolean;
  status: string | null; plan: string | null; trial_ends_at: string | null; free_period: boolean;
};
type Overview = {
  salons_total: number; salons_real: number; salons_demo: number;
  subs_active: number; subs_trialing: number; subs_expired: number; subs_pending: number; subs_none: number;
  trials_ending_7d: number; cancellations: number; past_due: number; free_period: number;
  projected_mrr_cents: number; salons: Salon[];
};
type Usage = {
  period: string; total: number; online: number; cancelled: number; no_show: number;
  per_salon: Record<string, { appointments: number; last_created_at: string | null }>;
  trend: { month: string; total: number }[];
};

const rpc = (fn: string, args?: Record<string, unknown>) => (supabase.rpc as any).call(supabase, fn, args);
const fmtDate = (s: string | null) =>
  s ? new Intl.DateTimeFormat("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date(s)) : "Niet beschikbaar";

function Kpi({ label, value, hint, tone }: { label: string; value: string | number; hint?: string; tone?: "muted" }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5" style={{ boxShadow: "var(--shadow-xs)" }}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${tone === "muted" ? "text-muted-foreground" : "text-foreground"}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-section-title">{title}</h2>
        {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function FinanceGroup({ title, note, rows }: { title: string; note: string; rows: [string, string, boolean?][] }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5" style={{ boxShadow: "var(--shadow-xs)" }}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{note}</p>
      <dl className="mt-3 divide-y divide-border/50">
        {rows.map(([label, value, strong]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-2">
            <dt className="text-xs text-muted-foreground min-w-0">{label}</dt>
            <dd className={`tabular-nums text-sm ${strong ? "font-semibold text-foreground" : "text-foreground"}`}>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function PlatformPage() {
  const { user, loading: authLoading } = useAuth();
  const access = usePlatformAccess();
  const periods = useMemo(() => lastPeriods(12), []);
  const [period, setPeriod] = useState(currentPeriod());
  const [overview, setOverview] = useState<Overview | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [finance, setFinance] = useState<FinanceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const allowed = access.owner && access.aal2;

  useEffect(() => {
    if (!allowed) return;
    rpc("platform_overview").then(({ data, error }: any) => {
      if (error) setError(platformErrorMessage(error.message)); else setOverview(data);
    });
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    setLoading(true);
    Promise.all([rpc("platform_usage", { _period: period }), rpc("platform_finance_report", { _period: period })])
      .then(([u, f]: any[]) => {
        if (u.error || f.error) setError(platformErrorMessage((u.error || f.error).message));
        else { setUsage(u.data); setFinance(f.data ?? []); setError(null); }
      })
      .finally(() => setLoading(false));
  }, [allowed, period]);

  if (authLoading || access.loading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Laden...</div>;
  }
  if (!user) return <Navigate to="/login" replace state={{ from: "/platform" }} />;

  if (!allowed) {
    return (
      <AppLayout title="Platformoverzicht">
        <div className="flex flex-col items-center text-center py-16 max-w-md mx-auto">
          <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mb-4">
            <ShieldAlert className="w-7 h-7 text-destructive" />
          </div>
          <h2 className="text-lg font-semibold mb-2">Geen toegang</h2>
          <p className="text-sm text-muted-foreground">
            {access.owner
              ? "Log in met je verificatiecode (MFA) om het platformoverzicht te openen."
              : "Deze pagina is alleen voor de beheerder van het GlowSuite-platform."}
          </p>
        </div>
      </AppLayout>
    );
  }

  const fin = sumFinance(finance);
  const realSalons = (overview?.salons ?? []);

  return (
    <AppLayout
      title="Platformoverzicht"
      subtitle="Alleen-lezen overzicht van alle salons op GlowSuite"
      compactMobile
      actions={
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-full lg:w-[190px]" aria-label="Periode"><SelectValue /></SelectTrigger>
          <SelectContent>
            {periods.map((p) => <SelectItem key={p} value={p}>{periodLabel(p)}</SelectItem>)}
          </SelectContent>
        </Select>
      }
    >
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</div>
      )}

      <Section title="Salons en abonnementen" note="Huidige stand, los van de gekozen periode. Demo-salons tellen niet mee in de abonnementscijfers.">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi label="Geregistreerde salons" value={overview?.salons_total ?? "…"} hint={overview ? `${overview.salons_real} echt, ${overview.salons_demo} demo` : undefined} />
          <Kpi label="Actief" value={overview?.subs_active ?? "…"} />
          <Kpi label="Proefperiode" value={overview?.subs_trialing ?? "…"} hint={overview ? `${overview.trials_ending_7d} eindigt binnen 7 dagen` : undefined} />
          <Kpi label="Verlopen" value={overview?.subs_expired ?? "…"} />
          <Kpi label="In afwachting" value={overview?.subs_pending ?? "…"} />
          <Kpi label="Opzeggingen" value={overview?.cancellations ?? "…"} />
          <Kpi label="Achterstallig" value={overview?.past_due ?? "…"} />
          <Kpi label="Gratis periode" value={overview?.free_period ?? "…"} />
          <Kpi label="Zonder abonnement" value={overview?.subs_none ?? "…"} />
          <Kpi label="Geprojecteerde MRR" value={overview ? formatCents(overview.projected_mrr_cents) : "…"} hint="Prijs van actieve maandabonnementen. Geen ontvangen omzet." />
        </div>
      </Section>

      <Section title={`Betalingen ${periodLabel(period)}`} note="Alleen door de betaalprovider bevestigde betalingen. Demobetalingen tellen niet mee.">
        <div className="grid gap-3 lg:grid-cols-2">
          <FinanceGroup title="Salonbetalingsvolume" note="Geld van salons. Geen omzet van GlowSuite." rows={[
            ["Bruto", finance ? formatCents(fin.grossCents) : "…"],
            ["Terugbetalingen", finance ? formatCents(fin.refundCents) : "…"],
            ["Netto", finance ? formatCents(fin.netCents) : "…", true],
          ]} />
          <FinanceGroup title="ISV-commissie" note="Alleen bevestigd telt als inkomen." rows={[
            ["Verwacht (nog niet door Viva bevestigd)", finance ? formatCents(fin.expectedIsvCents) : "…"],
            ["Bevestigd", finance ? formatCents(fin.confirmedIsvCents) : "…", true],
            ["Teruggedraaid", finance ? formatCents(fin.reversedIsvCents) : "…"],
            ["GlowPay-marge (oud)", finance ? formatCents(fin.legacyMarginCents) : "…"],
          ]} />
        </div>
        {finance && fin.unconfirmedCount > 0 && (
          <p className="text-xs text-muted-foreground">{fin.unconfirmedCount} betaling(en) hebben nog alleen een verwachte commissie.</p>
        )}
      </Section>

      <Section title={`Gebruik ${periodLabel(period)}`} note="Afspraken van echte salons, zonder demo-afspraken.">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Afspraken" value={usage?.total ?? "…"} />
          <Kpi label="Online boekingen" value={usage?.online ?? "…"} />
          <Kpi label="Geannuleerd" value={usage?.cancelled ?? "…"} />
          <Kpi label="No-shows" value={usage?.no_show ?? "…"} />
        </div>
        <div className="rounded-2xl border border-border/70 bg-card p-4 sm:p-5" style={{ boxShadow: "var(--shadow-xs)" }}>
          <p className="text-sm font-semibold mb-3">Afspraken per maand (laatste 6 maanden)</p>
          {usage && usage.trend.some((t) => t.total > 0) ? (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={usage.trend.map((t) => ({ ...t, label: periodLabel(t.month).split(" ")[0] }))}>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} stroke="hsl(var(--muted-foreground))" />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} width={28} stroke="hsl(var(--muted-foreground))" />
                  <Tooltip cursor={{ fill: "hsl(var(--secondary))" }} contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--border))", background: "hsl(var(--card))", fontSize: 12 }} />
                  <Bar dataKey="total" name="Afspraken" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">{loading ? "Laden..." : "Nog geen afspraken in deze periode."}</p>
          )}
        </div>
      </Section>

      <Section title="Salons" note="Alleen salongegevens op platformniveau. Geen klantgegevens.">
        {realSalons.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            <Building2 className="w-6 h-6 mx-auto mb-2" />Nog geen salons.
          </div>
        ) : (
          <>
            <div className="hidden md:block overflow-hidden rounded-2xl border border-border/70 bg-card" style={{ boxShadow: "var(--shadow-xs)" }}>
              <table className="w-full text-sm">
                <thead className="bg-secondary/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-4 py-3">Salon</th>
                    <th className="text-left font-medium px-4 py-3">Abonnement</th>
                    <th className="text-left font-medium px-4 py-3">Pakket</th>
                    <th className="text-left font-medium px-4 py-3">Geregistreerd</th>
                    <th className="text-right font-medium px-4 py-3">Afspraken</th>
                    <th className="text-left font-medium px-4 py-3">Laatste afspraak gemaakt</th>
                  </tr>
                </thead>
                <tbody>
                  {realSalons.map((s) => {
                    const u = usage?.per_salon?.[s.tenant_id];
                    return (
                      <tr key={s.tenant_id} className="border-t border-border/50">
                        <td className="px-4 py-3">
                          <span className="font-medium">{s.salon_name}</span>
                          {s.is_demo && <span className="ml-2 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Demo</span>}
                        </td>
                        <td className="px-4 py-3">{statusLabel(s.status)}{s.free_period ? " (gratis periode)" : ""}</td>
                        <td className="px-4 py-3 text-muted-foreground">{s.plan ?? "Niet beschikbaar"}</td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">{fmtDate(s.created_at)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{s.is_demo ? "Niet beschikbaar" : (u?.appointments ?? "…")}</td>
                        <td className="px-4 py-3 tabular-nums text-muted-foreground">{s.is_demo ? "Niet beschikbaar" : fmtDate(u?.last_created_at ?? null)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="md:hidden space-y-2">
              {realSalons.map((s) => {
                const u = usage?.per_salon?.[s.tenant_id];
                return (
                  <div key={s.tenant_id} className="rounded-2xl border border-border/70 bg-card p-4">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium min-w-0 break-words">{s.salon_name}</p>
                      {s.is_demo && <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">Demo</span>}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{statusLabel(s.status)}{s.free_period ? " (gratis periode)" : ""} · {s.plan ?? "Geen pakket"}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div><p className="text-muted-foreground">Geregistreerd</p><p className="tabular-nums">{fmtDate(s.created_at)}</p></div>
                      <div><p className="text-muted-foreground">Afspraken</p><p className="tabular-nums">{s.is_demo ? "Niet beschikbaar" : (u?.appointments ?? "…")}</p></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Section>
    </AppLayout>
  );
}
