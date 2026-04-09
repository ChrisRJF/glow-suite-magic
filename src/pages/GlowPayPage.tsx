import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { usePayments } from "@/hooks/usePayments";
import { useAppointments, useCustomers, useServices, useSettings, usePaymentLinks } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import {
  CreditCard, Euro, AlertTriangle, CheckCircle2, Clock, XCircle,
  Shield, TrendingUp, ArrowRight, RotateCcw, Send, Eye,
  Wallet, Banknote, Smartphone, QrCode, Link2, Plus, Copy, ExternalLink
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type TabType = "overzicht" | "betalingen" | "regels" | "betaallinks";


export default function GlowPayPage() {
  const { data: payments, refetch: refetchPayments } = usePayments();
  const { data: appointments } = useAppointments();
  const { data: customers } = useCustomers();
  const { data: services } = useServices();
  const { data: settings } = useSettings();
  const { data: paymentLinks, refetch: refetchLinks } = usePaymentLinks();
  const { update: updatePayment } = useCrud("payments");
  const { insert: insertLink, update: updateLink } = useCrud("payment_links");
  const [activeTab, setActiveTab] = useState<TabType>("overzicht");
  const [selectedPayment, setSelectedPayment] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkForm, setLinkForm] = useState({ amount: "", description: "", customer_id: "", type: "link" });

  const s = settings.length > 0 ? settings[0] as any : null;

  const todayStr = new Date().toISOString().split("T")[0];

  const stats = useMemo(() => {
    const todayPayments = payments.filter(p => p.created_at?.startsWith(todayStr));
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const weekPayments = payments.filter(p => new Date(p.created_at) >= weekStart);

    const betaaldVandaag = todayPayments.filter(p => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
    const betaaldWeek = weekPayments.filter(p => p.status === "paid").reduce((s, p) => s + Number(p.amount), 0);
    const openstaand = payments.filter(p => p.status === "pending").reduce((s, p) => s + Number(p.amount), 0);
    const aanbetalingen = payments.filter(p => p.status === "paid" && p.payment_type === "deposit").reduce((s, p) => s + Number(p.amount), 0);
    const mislukt = payments.filter(p => p.status === "failed").length;
    const noshowProtected = appointments.filter(a => a.payment_required && (a.payment_status === "betaald" || a.deposit_amount && Number(a.deposit_amount) > 0)).length;
    const totalPaid = payments.filter(p => p.status === "paid").length;
    const totalAll = payments.length;
    const conversie = totalAll > 0 ? Math.round((totalPaid / totalAll) * 100) : 0;

    return { betaaldVandaag, betaaldWeek, openstaand, aanbetalingen, mislukt, noshowProtected, conversie };
  }, [payments, appointments, todayStr]);

  const handleMarkPaid = async (id: string) => {
    await updatePayment(id, { status: "paid", paid_at: new Date().toISOString() });
    toast.success("Betaling gemarkeerd als betaald");
    refetchPayments();
  };

  const handleRefund = async (id: string) => {
    await updatePayment(id, { status: "refunded" });
    toast.success("Terugbetaling geregistreerd (demo)");
    refetchPayments();
  };

  const handleRetry = async (id: string) => {
    // Simulate retry: randomly succeed or fail
    const success = Math.random() > 0.3;
    await updatePayment(id, { status: success ? "paid" : "failed", paid_at: success ? new Date().toISOString() : null });
    toast[success ? "success" : "error"](success ? "Betaling opnieuw gelukt!" : "Betaling opnieuw mislukt");
    refetchPayments();
  };

  const handleReminder = async (id: string) => {
    toast.success("Betaalherinnering verstuurd (demo)");
  };

  const getRemainingAmount = (p: any) => {
    if (p.payment_type === "deposit" && p.status === "paid") {
      const appt = appointments.find(a => a.id === p.appointment_id);
      if (appt) return Math.max(0, (Number(appt.price) || 0) - Number(p.amount));
    }
    return 0;
  };

  const getCustomerName = (id: string | null) => customers.find(c => c.id === id)?.name || "Onbekend";
  const getStatusBadge = (status: string) => {
    const map: Record<string, { label: string; class: string; icon: typeof CheckCircle2 }> = {
      paid: { label: "Betaald", class: "bg-success/15 text-success", icon: CheckCircle2 },
      pending: { label: "In afwachting", class: "bg-warning/15 text-warning", icon: Clock },
      failed: { label: "Mislukt", class: "bg-destructive/15 text-destructive", icon: XCircle },
      cancelled: { label: "Geannuleerd", class: "bg-muted text-muted-foreground", icon: XCircle },
      refunded: { label: "Terugbetaald", class: "bg-primary/15 text-primary", icon: RotateCcw },
    };
    const info = map[status] || map.pending;
    return (
      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[11px] font-medium", info.class)}>
        <info.icon className="w-3 h-3" /> {info.label}
      </span>
    );
  };

  const getMethodIcon = (method: string | null) => {
    if (method === "ideal") return "🏦";
    if (method === "bancontact") return "💳";
    if (method === "creditcard") return "💳";
    if (method === "pin") return "📱";
    if (method === "contant") return "💵";
    return "💰";
  };

  const handleCreateLink = async () => {
    const amount = Number(linkForm.amount);
    if (amount <= 0) { toast.error("Vul een geldig bedrag in"); return; }
    const linkId = crypto.randomUUID().slice(0, 8);
    const linkUrl = `https://pay.glowsuite.nl/${linkId}`;
    await insertLink({
      amount,
      description: linkForm.description,
      customer_id: linkForm.customer_id || null,
      type: linkForm.type,
      status: "open",
      link_url: linkUrl,
    });
    toast.success("Betaalverzoek aangemaakt!");
    setShowLinkForm(false);
    setLinkForm({ amount: "", description: "", customer_id: "", type: "link" });
    refetchLinks();
  };

  const handleCopyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Link gekopieerd!");
  };

  const handleMarkLinkPaid = async (id: string) => {
    await updateLink(id, { status: "betaald", paid_at: new Date().toISOString() });
    toast.success("Betaalverzoek gemarkeerd als betaald");
    refetchLinks();
  };

  const handleResendLink = (id: string) => {
    toast.success("Betaalverzoek opnieuw verstuurd (demo)");
  };

  const getLinkStatusBadge = (status: string) => {
    const map: Record<string, { label: string; class: string }> = {
      open: { label: "Open", class: "bg-warning/15 text-warning" },
      betaald: { label: "Betaald", class: "bg-success/15 text-success" },
      mislukt: { label: "Mislukt", class: "bg-destructive/15 text-destructive" },
      verlopen: { label: "Verlopen", class: "bg-muted text-muted-foreground" },
    };
    const info = map[status] || map.open;
    return <span className={cn("px-2 py-0.5 rounded-lg text-[11px] font-medium", info.class)}>{info.label}</span>;
  };

  const tabs: { key: TabType; label: string }[] = [
    { key: "overzicht", label: "Overzicht" },
    { key: "betalingen", label: "Betalingen" },
    { key: "betaallinks", label: "Betaallinks & QR" },
    { key: "regels", label: "Betaalregels" },
  ];

  return (
    <AppLayout title="GlowPay" subtitle="Betalingen & no-show bescherming">
      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-secondary/50 p-1 rounded-xl w-fit">
        {tabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={cn("px-4 py-2 rounded-lg text-sm font-medium transition-all",
              activeTab === tab.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overzicht" && (
        <>
          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {[
              { label: "Betaald vandaag", value: formatEuro(stats.betaaldVandaag), icon: Euro, color: "text-success" },
              { label: "Openstaand", value: formatEuro(stats.openstaand), icon: Clock, color: "text-warning" },
              { label: "Aanbetalingen", value: formatEuro(stats.aanbetalingen), icon: Wallet, color: "text-primary" },
              { label: "Betaald deze week", value: formatEuro(stats.betaaldWeek), icon: TrendingUp, color: "text-success" },
            ].map((stat, i) => (
              <div key={stat.label} className="glass-card p-4 opacity-0 animate-fade-in-up" style={{ animationDelay: `${i * 80}ms` }}>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center">
                    <stat.icon className={cn("w-4 h-4", stat.color)} />
                  </div>
                </div>
                <p className="text-xl font-bold tabular-nums">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>

          {/* Secondary Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="glass-card p-4 flex items-center gap-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '320ms' }}>
              <div className="w-10 h-10 rounded-xl bg-destructive/15 flex items-center justify-center">
                <XCircle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-lg font-bold">{stats.mislukt}</p>
                <p className="text-xs text-muted-foreground">Mislukte betalingen</p>
              </div>
            </div>
            <div className="glass-card p-4 flex items-center gap-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '400ms' }}>
              <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
                <Shield className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-lg font-bold">{stats.noshowProtected}</p>
                <p className="text-xs text-muted-foreground">No-show beschermd</p>
              </div>
            </div>
            <div className="glass-card p-4 flex items-center gap-4 opacity-0 animate-fade-in-up" style={{ animationDelay: '480ms' }}>
              <div className="w-10 h-10 rounded-xl bg-success/15 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-success" />
              </div>
              <div>
                <p className="text-lg font-bold">{stats.conversie}%</p>
                <p className="text-xs text-muted-foreground">Betaalconversie</p>
              </div>
            </div>
          </div>

          {/* Recent Payments */}
          <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '560ms' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-primary" /> Recente betalingen
              </h3>
              <Button variant="ghost" size="sm" onClick={() => setActiveTab("betalingen")}>
                Alles bekijken <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
            <div className="space-y-2">
              {payments.slice(0, 5).map(p => (
                <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
                  <span className="text-lg">{getMethodIcon(p.method)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{getCustomerName(p.customer_id)}</p>
                    <p className="text-xs text-muted-foreground">{p.payment_type === "deposit" ? "Aanbetaling" : "Volledige betaling"}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-semibold tabular-nums">{formatEuro(Number(p.amount))}</p>
                    {getStatusBadge(p.status)}
                  </div>
                </div>
              ))}
              {payments.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">Nog geen betalingen</p>
              )}
            </div>
          </div>
        </>
      )}

      {activeTab === "betalingen" && (
        <div className="glass-card p-6 opacity-0 animate-fade-in-up">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary" /> Alle betalingen
          </h3>
          <div className="space-y-2">
            {payments.map(p => (
              <div key={p.id}
                className={cn("flex items-center gap-3 p-3 rounded-xl transition-colors cursor-pointer",
                  selectedPayment === p.id ? "bg-primary/10 border border-primary/20" : "bg-secondary/30 hover:bg-secondary/50 border border-transparent")}
                onClick={() => setSelectedPayment(selectedPayment === p.id ? null : p.id)}>
                <span className="text-lg flex-shrink-0">{getMethodIcon(p.method)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{getCustomerName(p.customer_id)}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.payment_type === "deposit" ? "Aanbetaling" : "Volledige betaling"}
                    {p.is_demo && " · Demo"}
                    {p.method && ` · ${p.method}`}
                  </p>
                  {selectedPayment === p.id && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {p.status === "pending" && (
                        <Button variant="gradient" size="sm" onClick={(e) => { e.stopPropagation(); handleMarkPaid(p.id); }}>
                          <CheckCircle2 className="w-3.5 h-3.5" /> Markeer betaald
                        </Button>
                      )}
                      {p.status === "failed" && (
                        <Button variant="gradient" size="sm" onClick={(e) => { e.stopPropagation(); handleRetry(p.id); }}>
                          <RotateCcw className="w-3.5 h-3.5" /> Opnieuw proberen
                        </Button>
                      )}
                      {p.status === "paid" && (
                        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleRefund(p.id); }}>
                          <RotateCcw className="w-3.5 h-3.5" /> Terugbetalen
                        </Button>
                      )}
                      {p.status === "pending" && (
                        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); handleReminder(p.id); }}>
                          <Send className="w-3.5 h-3.5" /> Herinnering
                        </Button>
                      )}
                      {p.status === "pending" && (
                        <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); toast.success("Betaalverzoek opnieuw verstuurd (demo)"); }}>
                          <Send className="w-3.5 h-3.5" /> Link opnieuw
                        </Button>
                      )}
                      {getRemainingAmount(p) > 0 && (
                        <div className="w-full mt-1 p-2 rounded-lg bg-warning/10 border border-warning/20">
                          <p className="text-[11px] text-warning font-medium">Restbedrag: {formatEuro(getRemainingAmount(p))}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold tabular-nums">{formatEuro(Number(p.amount))}</p>
                  {getStatusBadge(p.status)}
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {new Date(p.created_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                  </p>
                </div>
              </div>
            ))}
            {payments.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">Geen betalingen gevonden</p>
            )}
          </div>
        </div>
      )}

      {activeTab === "regels" && (
        <div className="space-y-4 max-w-2xl opacity-0 animate-fade-in-up">
          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4 text-primary" /> Actieve betaalregels
            </h3>
            <div className="space-y-3">
              {[
                { label: "Aanbetaling nieuwe klanten", desc: "Nieuwe klanten betalen vooraf", active: s?.deposit_new_client ?? true, icon: "👤" },
                { label: "No-show bescherming", desc: "Klanten met no-show geschiedenis betalen vooraf", active: s?.deposit_noshow_risk ?? true, icon: "🛡️" },
                { label: "VIP vrijstelling", desc: "VIP klanten betalen niet vooraf", active: s?.skip_prepay_vip ?? true, icon: "⭐" },
                { label: `Volledige betaling boven ${formatEuro(Number(s?.full_prepay_threshold) || 150)}`, desc: "Dure behandelingen vereisen volledige vooruitbetaling", active: true, icon: "💎" },
              ].map((rule, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
                  <span className="text-lg flex-shrink-0">{rule.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{rule.label}</p>
                    <p className="text-xs text-muted-foreground">{rule.desc}</p>
                  </div>
                  <span className={cn("px-2 py-0.5 rounded-lg text-[11px] font-medium",
                    rule.active ? "bg-success/15 text-success" : "bg-muted text-muted-foreground")}>
                    {rule.active ? "Actief" : "Uit"}
                  </span>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" className="w-full mt-4" onClick={() => window.location.href = "/instellingen"}>
              <CreditCard className="w-3.5 h-3.5" /> Regels aanpassen in Instellingen
            </Button>
          </div>

          <div className="glass-card p-6">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-primary" /> Betaalmethoden
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {[
                { name: "iDEAL", icon: "🏦", desc: "Bankbetaling NL" },
                { name: "Bancontact", icon: "💳", desc: "Bankbetaling BE" },
                { name: "Creditcard", icon: "💳", desc: "Visa / Mastercard" },
                { name: "Apple Pay", icon: "🍎", desc: "Mobiel betalen" },
                { name: "Pin", icon: "📱", desc: "In salon" },
                { name: "Contant", icon: "💵", desc: "In salon" },
              ].map(m => (
                <div key={m.name} className="p-3 rounded-xl bg-secondary/30 flex items-center gap-3">
                  <span className="text-lg">{m.icon}</span>
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-[11px] text-muted-foreground">{m.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-4 border border-primary/20">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg gradient-bg flex items-center justify-center flex-shrink-0">
                <Banknote className="w-4 h-4 text-primary-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">GlowPay aanbetaling voorbeeld</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Aanbetaling percentage: <span className="font-semibold text-foreground">{s?.deposit_percentage ?? 50}%</span>
                  {" · "}Behandeling €100 → aanbetaling {formatEuro((s?.deposit_percentage ?? 50))}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
