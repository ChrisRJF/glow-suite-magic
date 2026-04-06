import { useState } from "react";
import { services, formatEuro } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Check, Clock, ArrowLeft, ArrowRight, Calendar, User, CreditCard, Loader2, Plus, Trash2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePaymentRules } from "@/hooks/usePaymentRules";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const availableSlots = ['09:00', '10:00', '11:30', '13:00', '14:30', '16:00', '17:00'];
const paymentMethods = [
  { id: 'ideal', label: 'iDEAL', icon: '🏦' },
  { id: 'bancontact', label: 'Bancontact', icon: '💳' },
  { id: 'creditcard', label: 'Creditcard', icon: '💳' },
  { id: 'applepay', label: 'Apple Pay', icon: '🍎' },
];

interface GroupMember {
  id: string;
  name: string;
  serviceId: string;
}

export default function BookingPage() {
  const [step, setStep] = useState(1);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('ideal');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentResult, setPaymentResult] = useState<{ status: string; message: string } | null>(null);
  // Group booking
  const [isGroupBooking, setIsGroupBooking] = useState(false);
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([]);

  const service = services.find(s => s.id === selectedService);

  const rules = usePaymentRules({
    deposit_new_client: true,
    deposit_percentage: 50,
    full_prepay_threshold: 150,
    skip_prepay_vip: false,
    deposit_noshow_risk: true,
    demo_mode: true,
  });

  const totalPrice = (() => {
    let total = service?.price || 0;
    groupMembers.forEach(m => {
      const s = services.find(sv => sv.id === m.serviceId);
      total += s?.price || 0;
    });
    return total;
  })();

  const paymentDecision = totalPrice > 0 ? rules.decide(totalPrice, null, true) : null;

  const addGroupMember = () => {
    setGroupMembers(prev => [...prev, { id: crypto.randomUUID(), name: '', serviceId: services[0]?.id || '' }]);
  };

  const removeGroupMember = (id: string) => {
    setGroupMembers(prev => prev.filter(m => m.id !== id));
  };

  const updateGroupMember = (id: string, field: keyof GroupMember, value: string) => {
    setGroupMembers(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const handleConfirm = async () => {
    if (!paymentDecision?.required) {
      toast.success("Afspraak bevestigd! ✅");
      setPaymentResult({ status: "success", message: isGroupBooking ? `Groepsboeking bevestigd! ${groupMembers.length + 1} personen geboekt.` : "Afspraak bevestigd! Geen betaling vereist." });
      return;
    }

    setPaymentLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-payment", {
        body: {
          amount: paymentDecision.amount,
          payment_type: paymentDecision.type,
          method: selectedMethod,
          is_demo: true,
        },
      });

      if (error) throw error;

      if (data?.demo) {
        if (data.payment?.status === "paid") {
          setPaymentResult({ status: "success", message: data.message });
          toast.success(data.message);
        } else {
          setPaymentResult({ status: "failed", message: data.message });
          toast.error(data.message);
        }
      } else if (data?.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err: any) {
      const msg = err?.message || "Betaling mislukt";
      setPaymentResult({ status: "failed", message: msg });
      toast.error(msg);
    } finally {
      setPaymentLoading(false);
    }
  };

  const resetAll = () => {
    setStep(1); setPaymentResult(null); setName(''); setPhone('');
    setSelectedService(null); setSelectedTime(null);
    setIsGroupBooking(false); setGroupMembers([]);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border p-5">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl gradient-bg flex items-center justify-center">
            <span className="text-sm font-bold text-primary-foreground">GS</span>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">Glow Studio</h1>
            <p className="text-[11px] text-muted-foreground">Online Afspraak Maken</p>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full p-6">
        {/* Steps */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                step >= s ? 'gradient-bg text-primary-foreground' : 'bg-secondary text-muted-foreground'
              )}>
                {step > s ? <Check className="w-4 h-4" /> : s}
              </div>
              <span className={cn("text-xs font-medium hidden sm:block", step >= s ? 'text-foreground' : 'text-muted-foreground')}>
                {s === 1 ? 'Behandeling' : s === 2 ? 'Tijd' : 'Gegevens'}
              </span>
              {s < 3 && <div className={cn("flex-1 h-px", step > s ? 'bg-primary' : 'bg-border')} />}
            </div>
          ))}
        </div>

        {/* Step 1: Choose Service */}
        {step === 1 && (
          <div className="space-y-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
            <h2 className="text-xl font-bold mb-2">Kies een behandeling</h2>

            {/* Group booking toggle */}
            <button onClick={() => { setIsGroupBooking(!isGroupBooking); if (isGroupBooking) setGroupMembers([]); }}
              className={cn("w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left text-sm",
                isGroupBooking ? "border-primary bg-primary/10" : "border-border bg-secondary/30 hover:bg-secondary/60")}>
              <Users className="w-5 h-5" />
              <div className="flex-1">
                <span className="font-medium">Groepsboeking</span>
                <p className="text-[11px] text-muted-foreground">Boek voor meerdere personen tegelijk</p>
              </div>
              <div className={`w-10 h-6 rounded-full transition-colors ${isGroupBooking ? "bg-primary" : "bg-secondary"}`}>
                <div className={`w-4 h-4 rounded-full bg-white transition-transform mt-1 ${isGroupBooking ? "translate-x-5" : "translate-x-1"}`} />
              </div>
            </button>

            <p className="text-xs text-muted-foreground mt-2 mb-1">{isGroupBooking ? "Hoofdpersoon — kies behandeling:" : ""}</p>

            {services.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedService(s.id)}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 text-left",
                  selectedService === s.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-secondary/30 hover:bg-secondary/60'
                )}
              >
                <div className="w-2 h-10 rounded-full" style={{ backgroundColor: s.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{s.name}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{s.duration} min</span>
                  </div>
                </div>
                <p className="text-sm font-bold tabular-nums">{formatEuro(s.price)}</p>
              </button>
            ))}

            {/* Group members */}
            {isGroupBooking && selectedService && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Extra personen</p>
                  <Button variant="outline" size="sm" onClick={addGroupMember}><Plus className="w-3.5 h-3.5 mr-1" />Persoon toevoegen</Button>
                </div>
                {groupMembers.map((member, idx) => (
                  <div key={member.id} className="p-3 rounded-xl bg-secondary/50 border border-border space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Persoon {idx + 2}</span>
                      <button onClick={() => removeGroupMember(member.id)} className="p-1 rounded hover:bg-destructive/20"><Trash2 className="w-3.5 h-3.5 text-destructive" /></button>
                    </div>
                    <input placeholder="Naam" value={member.name} onChange={e => updateGroupMember(member.id, 'name', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                    <select value={member.serviceId} onChange={e => updateGroupMember(member.id, 'serviceId', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                      {services.map(s => <option key={s.id} value={s.id}>{s.name} — {formatEuro(s.price)}</option>)}
                    </select>
                  </div>
                ))}
                {groupMembers.length > 0 && (
                  <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 text-sm">
                    <span className="text-muted-foreground">Totaalprijs:</span> <span className="font-bold">{formatEuro(totalPrice)}</span>
                    <span className="text-muted-foreground ml-2">({groupMembers.length + 1} personen)</span>
                  </div>
                )}
              </div>
            )}

            <Button variant="gradient" className="w-full mt-4"
              disabled={!selectedService || (isGroupBooking && groupMembers.some(m => !m.name))}
              onClick={() => setStep(2)}>
              Volgende <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 2: Choose Time */}
        {step === 2 && (
          <div className="opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
            <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Terug
            </button>
            <h2 className="text-xl font-bold mb-2">Kies een tijdstip</h2>
            <p className="text-sm text-muted-foreground mb-6">
              <Calendar className="w-4 h-4 inline mr-1" />Dinsdag 22 maart 2026
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {availableSlots.map((slot) => (
                <button key={slot} onClick={() => setSelectedTime(slot)}
                  className={cn(
                    "p-3 rounded-xl text-sm font-medium tabular-nums border transition-all duration-200",
                    selectedTime === slot ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-secondary/60'
                  )}>
                  {slot}
                </button>
              ))}
            </div>
            <Button variant="gradient" className="w-full mt-6" disabled={!selectedTime} onClick={() => setStep(3)}>
              Volgende <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 3: Enter Details + Payment */}
        {step === 3 && (
          <div className="opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
            <button onClick={() => { setStep(2); setPaymentResult(null); }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Terug
            </button>
            <h2 className="text-xl font-bold mb-6">Jouw gegevens</h2>

            {/* Summary */}
            <div className="glass-card p-4 mb-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Behandeling</span>
                <span className="font-medium">{service?.name}</span>
              </div>
              {isGroupBooking && groupMembers.map((m, i) => {
                const mSvc = services.find(s => s.id === m.serviceId);
                return (
                  <div key={m.id} className="flex items-center justify-between text-sm mt-1">
                    <span className="text-muted-foreground text-xs">{m.name || `Persoon ${i + 2}`}</span>
                    <span className="text-xs">{mSvc?.name} — {formatEuro(mSvc?.price || 0)}</span>
                  </div>
                );
              })}
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">Tijdstip</span>
                <span className="font-medium">{selectedTime} · Di 22 mrt</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">Totaalprijs</span>
                <span className="font-bold">{formatEuro(totalPrice)}</span>
              </div>
              {isGroupBooking && (
                <div className="mt-2 pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" />Groepsboeking · {groupMembers.length + 1} personen</span>
                </div>
              )}
            </div>

            {/* Payment Decision Info */}
            {paymentDecision && (
              <div className={cn(
                "p-4 rounded-xl mb-6 text-sm",
                paymentDecision.required ? "bg-primary/10 border border-primary/20" : "bg-success/10 border border-success/20"
              )}>
                <div className="flex items-center gap-2 mb-1">
                  <CreditCard className="w-4 h-4" />
                  <span className="font-medium">
                    {paymentDecision.required
                      ? paymentDecision.type === "full" ? "Volledige betaling vereist" : "Aanbetaling vereist"
                      : "Geen betaling nodig"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{paymentDecision.reason}</p>
                {paymentDecision.required && (
                  <p className="font-semibold mt-1">Te betalen: {formatEuro(paymentDecision.amount)}</p>
                )}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Naam</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input type="text" placeholder="Je volledige naam" value={name} onChange={(e) => setName(e.target.value)}
                    className="w-full h-11 pl-10 pr-4 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Telefoonnummer</label>
                <input type="tel" placeholder="+31 6 1234 5678" value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
              </div>
            </div>

            {/* Payment Method Selection */}
            {paymentDecision?.required && (
              <div className="mt-6">
                <label className="text-sm font-medium mb-2 block">Betaalmethode</label>
                <div className="grid grid-cols-2 gap-2">
                  {paymentMethods.map((m) => (
                    <button key={m.id} onClick={() => setSelectedMethod(m.id)}
                      className={cn(
                        "p-3 rounded-xl border text-sm font-medium transition-all duration-200 flex items-center gap-2",
                        selectedMethod === m.id ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-secondary/60"
                      )}>
                      <span>{m.icon}</span> {m.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Payment Result */}
            {paymentResult && (
              <div className={cn(
                "mt-6 p-4 rounded-xl text-sm text-center",
                paymentResult.status === "success" ? "bg-success/10 border border-success/20 text-success" : "bg-destructive/10 border border-destructive/20 text-destructive"
              )}>
                <p className="font-semibold">{paymentResult.message}</p>
                {paymentResult.status === "success" && (
                  <p className="text-xs mt-1 text-muted-foreground">Je ontvangt een bevestiging per e-mail.</p>
                )}
              </div>
            )}

            {!paymentResult && (
              <Button variant="gradient" className="w-full mt-6" disabled={!name || !phone || paymentLoading} onClick={handleConfirm}>
                {paymentLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Betaling verwerken...</>
                ) : paymentDecision?.required ? (
                  <><CreditCard className="w-4 h-4" /> Betaal {formatEuro(paymentDecision.amount)}</>
                ) : (
                  <><Check className="w-4 h-4" /> Afspraak Bevestigen</>
                )}
              </Button>
            )}

            {paymentResult && (
              <Button variant="outline" className="w-full mt-3" onClick={resetAll}>
                Nieuwe afspraak maken
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
