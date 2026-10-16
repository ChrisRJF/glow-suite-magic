import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { usePlatformAccess } from "@/hooks/usePlatformAccess";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";

type Fee = { source: string; online_bps: number; online_fixed_cents: number; terminal_bps: number; terminal_fixed_cents: number };
type Salon = { tenant_id: string; salon_name: string; is_demo: boolean; fee: Fee };
const eur = (c: number) => (c / 100).toLocaleString("nl-NL", { style: "currency", currency: "EUR" });

// Platform owner only. UI gate is a hint; the RPCs enforce owner + AAL2 and write audit_logs.
function FeeRow({ title, fee, tenant, canReset, onSaved }: { title: string; fee: Fee; tenant: string | null; canReset: boolean; onSaved: () => void }) {
  const [v, setV] = useState({ op: fee.online_bps / 100, of: fee.online_fixed_cents / 100, tp: fee.terminal_bps / 100, tf: fee.terminal_fixed_cents / 100 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const call = async (reset: boolean) => {
    setBusy(true); setErr(null);
    const { error } = await (supabase.rpc as any)("platform_set_isv_fee", {
      _tenant: tenant, _online_bps: Math.round(v.op * 100), _online_fixed_cents: Math.round(v.of * 100),
      _terminal_bps: Math.round(v.tp * 100), _terminal_fixed_cents: Math.round(v.tf * 100), _reset: reset });
    setBusy(false);
    if (error) setErr(error.message.includes("bounds") ? "Waarde buiten bereik (max 20% en € 100)." : "Opslaan mislukt.");
    else onSaved();
  };
  const ex = Math.min(Math.floor((5000 * Math.round(v.op * 100) + 5000) / 10000) + Math.round(v.of * 100), 4999);
  const field = (k: keyof typeof v, label: string) => (
    <label className="text-xs text-muted-foreground">{label}
      <Input type="number" min={0} step="0.01" value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} className="mt-1 h-9" />
    </label>);
  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{title}</p>
        <span className="text-xs text-muted-foreground">{fee.source === "tenant" ? "Eigen tarief" : "Standaard"}</span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {field("op", "Online %")}{field("of", "Online vast (€)")}{field("tp", "Terminal %")}{field("tf", "Terminal vast (€)")}
      </div>
      <p className="text-xs text-muted-foreground">Voorbeeld online betaling van {eur(5000)}: GlowSuite-fee {eur(ex)}, salon ontvangt {eur(5000 - ex)} (voor Viva-kosten).</p>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => call(false)}>Opslaan</Button>
        {canReset && fee.source === "tenant" && <Button size="sm" variant="outline" disabled={busy} onClick={() => call(true)}>Terug naar standaard</Button>}
      </div>
    </Card>);
}

export default function PlatformIsvFeesPage() {
  const { user, loading } = useAuth();
  const access = usePlatformAccess();
  const [data, setData] = useState<{ default: Fee; salons: Salon[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [k, setK] = useState(0);
  useEffect(() => {
    if (!access.owner) return;
    (supabase.rpc as any)("platform_isv_fees_list").then(({ data, error }: any) => {
      if (error) setErr(error.message.includes("mfa") ? "Log in met tweestapsverificatie." : "Laden mislukt."); else setData(data);
    });
  }, [access.owner, k]);
  if (loading || access.loading) return <div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: "/platform/isv-fees" }} />;
  if (!access.owner) return <div className="p-6 text-sm">Geen toegang. <Link to="/platform" className="text-primary underline">Terug</Link></div>;
  const reload = () => setK((x) => x + 1);
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold">GlowPay fees per salon</h1>
        <p className="text-sm text-muted-foreground">Alleen voor de platformbeheerder. De fee zit in het bedrag dat de klant betaalt en wordt per betaling vastgelegd. Wijzigingen gelden voor nieuwe betalingen en worden gelogd.</p>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      {!data ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
        <>
          <FeeRow key={`d${k}`} title="Standaard voor alle salons" fee={data.default} tenant={null} canReset={false} onSaved={reload} />
          {data.salons.filter((s) => !s.is_demo).map((s) => (
            <FeeRow key={`${s.tenant_id}${k}`} title={s.salon_name} fee={s.fee} tenant={s.tenant_id} canReset onSaved={reload} />))}
          <p className="text-xs text-muted-foreground">Demo-salons worden niet getoond; daar wordt nooit echt afgerekend.</p>
        </>)}
    </div>);
}
