import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";
import { cn } from "@/lib/utils";
import { PaymentMethodLogo } from "@/components/PaymentMethodLogo";
import { Check, CheckCircle2, Crown, Loader2, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

type Plan = { id: string; name: string; description: string; price: number; billing_interval: string; benefits: string[]; included_treatments: number; discount_percentage: number; priority_booking: boolean };
type PortalData = { salon: { name: string; primary_color?: string; secondary_color?: string }; plans: Plan[] };

function callPublicMemberships<T>(body: Record<string, unknown>) {
  return supabase.functions.invoke("public-abonnementen", { body }).then(({ data, error }) => {
    if (error) throw new Error(error.message || "Abonnementen zijn niet bereikbaar");
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as T;
  });
}

const intervalLabels: Record<string, string> = { monthly: "maand", quarterly: "kwartaal", yearly: "jaar" };
const paymentMethods = [
  { id: "ideal", label: "iDEAL | Wero" },
  { id: "creditcard", label: "Creditcard" },
  { id: "bancontact", label: "Bancontact" },
];

export default function MembershipPortalPage() {
  const { salonSlug = "" } = useParams();
  const isEmbed = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1";
  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Plan | null>(null);
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "" });
  const [method, setMethod] = useState("ideal");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await callPublicMemberships<PortalData>({ action: "get_abonnementen", slug: salonSlug }));
    } catch (err: any) {
      setError(err.message || "Abonnementspagina kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [salonSlug]);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("membership")) setConfirmed(true);
  }, []);

  const join = async () => {
    if (!selected || !customer.name || !customer.email) { toast.error("Vul je naam en e-mail in"); return; }
    setCheckoutLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/abonnementen/${salonSlug}`;
      const result = await callPublicMemberships<{ checkoutUrl?: string; demo?: boolean }>({ action: "join_membership", slug: salonSlug, membership_plan_id: selected.id, customer, method, redirect_url: redirectUrl });
      if (result.checkoutUrl) { window.location.href = result.checkoutUrl; return; }
      setConfirmed(true);
    } catch (err: any) {
      toast.error(err.message || "Aanmelden kon niet worden gestart.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading) return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;
  if (error || !data) return <div className="min-h-screen bg-background flex items-center justify-center p-4"><div className="glass-card p-6 max-w-sm text-center"><p className="text-sm font-semibold">Abonnementen niet beschikbaar</p><p className="text-xs text-muted-foreground mt-1">{error || "Deze pagina is nog niet actief."}</p><Button variant="outline" size="sm" className="mt-4" onClick={load}>Opnieuw proberen</Button></div></div>;
  if (confirmed) return <main className={cn("min-h-screen bg-background p-4", isEmbed && "min-h-0")}><div className="mx-auto max-w-lg glass-card p-6 text-center"><CheckCircle2 className="w-10 h-10 text-success mx-auto mb-3" /><h1 className="text-xl font-semibold">Aanmelding ontvangen</h1><p className="text-sm text-muted-foreground mt-2">Bedankt. Je abonnement bij {data.salon.name} wordt automatisch geactiveerd zodra de betaling is bevestigd.</p></div></main>;

  return (
    <main className={cn("min-h-screen bg-background", isEmbed ? "p-3" : "p-4 sm:p-8")}>
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <div className="w-11 h-11 rounded-xl bg-primary/15 flex items-center justify-center mb-3"><Crown className="w-5 h-5 text-primary" /></div>
          <h1 className="text-2xl font-semibold">{data.salon.name} abonnementen</h1>
          <p className="text-sm text-muted-foreground mt-1">Kies je vaste voordeel en betaal veilig online.</p>
        </header>

        {data.plans.length === 0 ? <div className="glass-card p-8 text-center text-sm text-muted-foreground">Nog geen abonnementen beschikbaar</div> : <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{data.plans.map((plan) => <article key={plan.id} className="glass-card p-6 flex flex-col"><div className="flex items-start justify-between gap-2"><h2 className="text-lg font-bold">{plan.name}</h2>{plan.priority_booking && <Sparkles className="w-4 h-4 text-primary" />}</div><p className="text-sm text-muted-foreground mt-2 min-h-[42px]">{plan.description || "Abonnementsvoordeel"}</p><div className="my-5"><span className="text-3xl font-bold text-primary">{formatEuro(Number(plan.price || 0))}</span><span className="text-sm text-muted-foreground">/{intervalLabels[plan.billing_interval] || "periode"}</span></div><ul className="space-y-2 mb-5 flex-1">{(plan.benefits || []).map((benefit) => <li key={benefit} className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 text-primary mt-0.5" />{benefit}</li>)}{plan.included_treatments > 0 && <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 text-primary mt-0.5" />{plan.included_treatments} behandeling(en) inbegrepen</li>}{plan.discount_percentage > 0 && <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 text-primary mt-0.5" />{plan.discount_percentage}% ledenkorting</li>}</ul><Button variant="gradient" onClick={() => setSelected(plan)}>Lid worden</Button></article>)}</div>}
      </div>

      {selected && <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3" onClick={() => setSelected(null)}><div className="glass-card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}><h2 className="text-lg font-semibold">Lid worden van {selected.name}</h2><p className="text-sm text-muted-foreground mt-1">Eerste termijn: {formatEuro(Number(selected.price || 0))}</p><div className="space-y-2 mt-4"><input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Naam" className="w-full px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm" /><input type="email" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} placeholder="E-mail" className="w-full px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm" /><input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="Telefoon" className="w-full px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm" /><div className="grid grid-cols-1 gap-2">{paymentMethods.map((paymentMethod) => <button key={paymentMethod.id} type="button" onClick={() => setMethod(paymentMethod.id)} className={cn("min-h-12 rounded-xl border px-3 text-left text-sm font-medium transition-all flex items-center justify-between gap-3", method === paymentMethod.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary/40 hover:bg-secondary/60")}><span>{paymentMethod.label}</span><PaymentMethodLogo method={paymentMethod.id} className="h-6 max-w-24" /></button>)}</div></div><Button variant="gradient" className="w-full mt-4" onClick={join} disabled={checkoutLoading}>{checkoutLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Veilig betalen</Button></div></div>}
    </main>
  );
}
