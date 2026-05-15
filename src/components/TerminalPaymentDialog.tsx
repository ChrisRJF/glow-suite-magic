import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useDemoMode } from "@/hooks/useDemoMode";
import { formatEuro } from "@/lib/data";
import { Loader2, CheckCircle2, XCircle, CreditCard, RotateCcw, Wifi, Smartphone } from "lucide-react";
import { toast } from "sonner";

type Terminal = { id: string; terminal_id: string; terminal_name: string; status: string; location_name: string | null };

type TerminalState =
  | "idle"
  | "initiating"
  | "waiting_customer"   // "Wachten op klant"
  | "present_card"       // "Kaart aanbieden"
  | "processing"         // "Betaling verwerken"
  | "paid"
  | "failed"
  | "cancelled"
  | "expired"
  | "reconnecting";

const STATE_LABELS: Record<TerminalState, string> = {
  idle: "Klaar",
  initiating: "Pinapparaat activeren…",
  waiting_customer: "Wachten op klant",
  present_card: "Kaart of telefoon aanbieden",
  processing: "Betaling verwerken…",
  paid: "Betaling gelukt",
  failed: "Betaling mislukt",
  cancelled: "Geannuleerd",
  expired: "Verlopen — probeer opnieuw",
  reconnecting: "Pinapparaat opnieuw verbinden…",
};

const TIP_OPTIONS = [0, 5, 10, 15];

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  amountCents: number;
  description?: string;
  appointmentId?: string | null;
  customerId?: string | null;
  source?: "appointment" | "checkout" | "manual" | "auto_revenue" | "membership";
  allowTip?: boolean;
  onPaid?: (paymentId: string) => void;
}

export function TerminalPaymentDialog({
  open, onOpenChange, amountCents, description = "Terminal betaling",
  appointmentId = null, customerId = null, source = "manual", allowTip = false, onPaid,
}: Props) {
  const { demoMode } = useDemoMode();
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [selectedTerminal, setSelectedTerminal] = useState<string>("");
  const [state, setState] = useState<TerminalState>("idle");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tipPct, setTipPct] = useState<number>(0);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  const tipCents = Math.round((amountCents * tipPct) / 100);
  const totalCents = amountCents + tipCents;

  const loadTerminals = async () => {
    const { data } = await supabase.from("viva_terminals").select("id,terminal_id,terminal_name,status,location_name").eq("status", "active");
    setTerminals((data as any) || []);
    if (data && data.length === 1) setSelectedTerminal((data[0] as any).terminal_id);
  };

  useEffect(() => {
    if (!open) return;
    setState("idle"); setPaymentId(null); setError(null); setTipPct(0);
    loadTerminals();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [open]);

  const startPayment = async () => {
    if (!selectedTerminal) { toast.error("Selecteer een pinapparaat"); return; }
    setState("initiating"); setError(null);
    const { data, error: err } = await supabase.functions.invoke("create-viva-terminal-payment", {
      body: { terminal_id: selectedTerminal, amount_cents: totalCents, description: tipCents ? `${description} (incl. €${(tipCents / 100).toFixed(2)} fooi)` : description, appointment_id: appointmentId, customer_id: customerId, source, is_demo: demoMode, tip_cents: tipCents },
    });
    if (err || (data as any)?.error) {
      setState("failed"); setError((data as any)?.detail || (data as any)?.error || err?.message || "Onbekende fout");
      return;
    }
    const pid = (data as any).payment_id as string;
    setPaymentId(pid); setState("waiting_customer");

    // Progressive UX: walk through human-friendly states
    let tick = 0;
    tickRef.current = window.setInterval(() => {
      tick += 1;
      if (tick === 2) setState((s) => (s === "waiting_customer" ? "present_card" : s));
      if (tick === 6) setState((s) => (s === "present_card" ? "processing" : s));
    }, 2000);

    const start = Date.now();
    let consecutiveErrors = 0;
    pollRef.current = window.setInterval(async () => {
      if (Date.now() - start > 90_000) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        if (tickRef.current) window.clearInterval(tickRef.current);
        setState((s) => (s === "paid" ? s : "expired"));
        return;
      }
      const { data: st, error: stErr } = await supabase.functions.invoke("viva-terminal-payment-status", { body: { payment_id: pid } });
      if (stErr) {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3) setState((s) => (s === "paid" ? s : "reconnecting"));
        return;
      }
      consecutiveErrors = 0;
      const status = (st as any)?.status;
      if (status === "paid") {
        if (pollRef.current) window.clearInterval(pollRef.current);
        if (tickRef.current) window.clearInterval(tickRef.current);
        setState("paid"); onPaid?.(pid);
        toast.success("Betaling gelukt");
      } else if (status === "failed" || status === "cancelled" || status === "expired") {
        if (pollRef.current) window.clearInterval(pollRef.current);
        if (tickRef.current) window.clearInterval(tickRef.current);
        setState(status as TerminalState);
      }
    }, 2500);
  };

  const retry = async () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (tickRef.current) window.clearInterval(tickRef.current);
    setState("idle"); setError(null); setPaymentId(null);
    await loadTerminals();
  };

  const close = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (tickRef.current) window.clearInterval(tickRef.current);
    onOpenChange(false);
  };

  const isLive = ["initiating", "waiting_customer", "present_card", "processing", "reconnecting"].includes(state);
  const isFailedish = ["failed", "cancelled", "expired"].includes(state);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> Betaal op pinapparaat</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl bg-secondary/40 p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{tipCents ? "Totaal incl. fooi" : "Te betalen"}</span>
              <span className="text-2xl font-bold tabular-nums">{formatEuro(totalCents / 100)}</span>
            </div>
            {tipCents > 0 && (
              <div className="flex items-center justify-between mt-1 text-xs text-muted-foreground">
                <span>Behandeling {formatEuro(amountCents / 100)}</span>
                <span>+ fooi {formatEuro(tipCents / 100)} ({tipPct}%)</span>
              </div>
            )}
          </div>

          {state === "idle" && allowTip && (
            <div>
              <label className="text-xs text-muted-foreground">Fooi (optioneel)</label>
              <div className="grid grid-cols-4 gap-2 mt-1">
                {TIP_OPTIONS.map((p) => (
                  <button key={p} type="button" onClick={() => setTipPct(p)}
                    className={`min-h-10 rounded-xl border text-sm font-medium transition-all ${tipPct === p ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary/40 hover:bg-secondary/60"}`}>
                    {p === 0 ? "Geen" : `${p}%`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {state === "idle" && (
            <div>
              <label className="text-xs text-muted-foreground">Pinapparaat</label>
              {terminals.length === 0 ? (
                <p className="text-xs text-destructive mt-1">Geen actieve pinapparaten. Voeg er één toe in Instellingen → GlowPay.</p>
              ) : (
                <select value={selectedTerminal} onChange={(e) => setSelectedTerminal(e.target.value)} className="w-full mt-1 px-3 py-3 rounded-xl bg-background border border-border text-sm min-h-12">
                  <option value="">Selecteer pinapparaat…</option>
                  {terminals.map((t) => (
                    <option key={t.id} value={t.terminal_id}>{t.terminal_name}{t.location_name ? ` — ${t.location_name}` : ""}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {state !== "idle" && (
            <div className="rounded-xl border border-border p-4 flex items-center gap-3">
              {state === "paid" ? <CheckCircle2 className="w-7 h-7 text-success shrink-0" /> :
                isFailedish ? <XCircle className="w-7 h-7 text-destructive shrink-0" /> :
                state === "reconnecting" ? <Wifi className="w-7 h-7 text-warning animate-pulse shrink-0" /> :
                state === "present_card" ? <Smartphone className="w-7 h-7 text-primary animate-pulse shrink-0" /> :
                <Loader2 className="w-7 h-7 animate-spin text-primary shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{STATE_LABELS[state]}</p>
                {state === "waiting_customer" && <p className="text-xs text-muted-foreground mt-0.5">Geef het pinapparaat aan de klant.</p>}
                {state === "present_card" && <p className="text-xs text-muted-foreground mt-0.5">Klant kan tikken, swipen of pincode invoeren.</p>}
                {state === "processing" && <p className="text-xs text-muted-foreground mt-0.5">Even geduld — bank bevestigt de betaling.</p>}
                {state === "reconnecting" && <p className="text-xs text-muted-foreground mt-0.5">We controleren of het pinapparaat nog online is.</p>}
                {error && <p className="text-xs text-destructive mt-1">{error}</p>}
                {paymentId && <p className="text-[10px] text-muted-foreground mt-1">Ref: {paymentId.slice(0, 8)}…</p>}
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 flex-col sm:flex-row">
          {state === "idle" && (
            <>
              <Button variant="ghost" onClick={close} className="w-full sm:w-auto">Annuleer</Button>
              <Button onClick={startPayment} disabled={!selectedTerminal || terminals.length === 0} className="w-full sm:w-auto">Start betaling</Button>
            </>
          )}
          {isLive && <Button variant="ghost" onClick={close} className="w-full sm:w-auto">Sluiten</Button>}
          {isFailedish && (
            <>
              <Button variant="ghost" onClick={close} className="w-full sm:w-auto">Sluiten</Button>
              <Button onClick={retry} className="w-full sm:w-auto"><RotateCcw className="w-4 h-4" /> Opnieuw proberen</Button>
            </>
          )}
          {state === "paid" && <Button onClick={close} className="w-full sm:w-auto">Klaar</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
