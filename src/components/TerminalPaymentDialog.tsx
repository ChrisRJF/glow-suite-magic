import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useDemoMode } from "@/hooks/useDemoMode";
import { formatEuro } from "@/lib/data";
import { Loader2, CheckCircle2, XCircle, CreditCard, RotateCcw, Wifi, Smartphone, AlertTriangle, Clock, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useVivaPosReady } from "@/components/VivaPosCredentialsCard";

type Terminal = { id: string; terminal_id: string; terminal_name: string; status: string; location_name: string | null; is_default?: boolean };

type TerminalState =
  | "idle"
  | "initiating"
  | "sent_to_terminal"     // "Naar terminal gestuurd"
  | "waiting_customer"     // "Wacht op kaart"
  | "processing"           // "Betaling verwerken"
  | "paid"                 // "Betaling ontvangen"
  | "long_running"         // "Duurt langer dan verwacht"
  | "failed"
  | "cancelled"
  | "expired"
  | "reconnecting";

const STATE_LABELS: Record<TerminalState, string> = {
  idle: "Klaar",
  initiating: "Pinapparaat activeren…",
  sent_to_terminal: "Naar terminal gestuurd",
  waiting_customer: "Wacht op kaart",
  processing: "Betaling verwerken…",
  paid: "Betaling ontvangen",
  long_running: "Duurt langer dan verwacht",
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
  const posReady = useVivaPosReady();
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [selectedTerminal, setSelectedTerminal] = useState<string>("");
  const [state, setState] = useState<TerminalState>("idle");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [vivaTxId, setVivaTxId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tipPct, setTipPct] = useState<number>(0);
  const [manualChecking, setManualChecking] = useState(false);
  const pollRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const idemKeyRef = useRef<string>("");
  const startedAtRef = useRef<number>(0);

  const tipCents = Math.round((amountCents * tipPct) / 100);
  const totalCents = amountCents + tipCents;

  // Allow at least 90s polling (demo & live).
  const POLL_INTERVAL_MS = 2_000;
  const POLL_DURATION_MS = 90_000;

  const loadTerminals = async () => {
    const { data } = await (supabase
      .from("viva_terminals")
      .select("id,terminal_id,terminal_name,status,location_name,is_default")
      .eq("status", "active") as any)
      .order("is_default", { ascending: false });
    const list = ((data as any) || []) as Terminal[];
    setTerminals(list);
    const def = list.find((t) => t.is_default);
    if (def) setSelectedTerminal(def.terminal_id);
    else if (list.length === 1) setSelectedTerminal(list[0].terminal_id);
  };

  const clearTimers = () => {
    if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
    if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
  };

  useEffect(() => {
    if (!open) return;
    setState("idle"); setPaymentId(null); setVivaTxId(null); setError(null); setTipPct(0);
    idemKeyRef.current = (crypto as any).randomUUID?.() || `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    loadTerminals();
    return () => clearTimers();
  }, [open]);

  const checkStatusOnce = async (pid: string) => {
    const { data: st, error: stErr } = await supabase.functions.invoke("viva-terminal-payment-status", { body: { payment_id: pid } });
    if (stErr) throw stErr;
    const status = (st as any)?.status;
    const tx = (st as any)?.viva_transaction_id;
    if (tx) setVivaTxId(String(tx));
    return { status, raw: st };
  };

  const handleTerminalStatus = (status: string, paidPaymentId = paymentId) => {
    if (status === "paid") {
      clearTimers();
      setState("paid");
      if (paidPaymentId) onPaid?.(paidPaymentId);
      toast.success("Betaling ontvangen");
      return true;
    }
    if (status === "failed" || status === "cancelled" || status === "expired") {
      clearTimers();
      setState(status as TerminalState);
      return true;
    }
    return false;
  };

  const manualRefresh = async () => {
    if (!paymentId || manualChecking) return;
    setManualChecking(true);
    try {
      const { status } = await checkStatusOnce(paymentId);
      if (!handleTerminalStatus(status, paymentId)) {
        toast.info("Nog geen bevestiging van Viva ontvangen.");
      }
    } catch (e: any) {
      toast.error(`Status check mislukt: ${e?.message || "onbekende fout"}`);
    } finally {
      setManualChecking(false);
    }
  };

  const startPayment = async () => {
    if (state !== "idle") return; // anti-double-click
    if (!selectedTerminal) { toast.error("Selecteer een pinapparaat"); return; }
    setState("initiating"); setError(null); setVivaTxId(null);
    const { data, error: err } = await supabase.functions.invoke("create-viva-terminal-payment", {
      body: {
        terminal_id: selectedTerminal,
        amount_cents: totalCents,
        description: tipCents ? `${description} (incl. €${(tipCents / 100).toFixed(2)} fooi)` : description,
        appointment_id: appointmentId,
        customer_id: customerId,
        source,
        is_demo: demoMode,
        tip_cents: tipCents,
        idempotency_key: idemKeyRef.current,
      },
    });
    if (err || (data as any)?.error || (data as any)?.success === false) {
      const d: any = data || {};
      const vivaMsg = d.message || d.detail || d.error || err?.message || "Onbekende fout";
      const vivaCode = d.code ? ` (${d.code})` : "";
      setState("failed");
      setError(`${vivaMsg}${vivaCode}`);
      return;
    }
    const pid = (data as any).payment_id as string;
    setPaymentId(pid); setState("sent_to_terminal");
    startedAtRef.current = Date.now();

    // Progressive UX states
    let tick = 0;
    tickRef.current = window.setInterval(() => {
      tick += 1;
      if (tick === 2) setState((s) => (s === "sent_to_terminal" ? "waiting_customer" : s));
      if (tick === 6) setState((s) => (s === "waiting_customer" ? "processing" : s));
    }, 2000);

    let consecutiveErrors = 0;
    pollRef.current = window.setInterval(async () => {
      if (Date.now() - startedAtRef.current > POLL_DURATION_MS) {
        // Do NOT mark failed. Move to long_running and continue background polling.
        if (tickRef.current) { window.clearInterval(tickRef.current); tickRef.current = null; }
        setState((s) => (["paid","failed","cancelled","expired"].includes(s) ? s : "long_running"));
        // Slow down polling
        if (pollRef.current) { window.clearInterval(pollRef.current); pollRef.current = null; }
        pollRef.current = window.setInterval(async () => {
          try {
            const { status } = await checkStatusOnce(pid);
            handleTerminalStatus(status, pid);
          } catch { /* keep trying */ }
        }, 5000);
        return;
      }
      try {
        const { status } = await checkStatusOnce(pid);
        consecutiveErrors = 0;
        handleTerminalStatus(status, pid);
      } catch {
        consecutiveErrors += 1;
        if (consecutiveErrors >= 3) setState((s) => (s === "paid" ? s : "reconnecting"));
      }
    }, POLL_INTERVAL_MS);
  };

  const retry = async () => {
    clearTimers();
    setState("idle"); setError(null); setPaymentId(null); setVivaTxId(null);
    await loadTerminals();
  };

  const close = () => {
    // Stop polling on close. Payment continues in backend; webhook will reconcile.
    clearTimers();
    onOpenChange(false);
  };

  const isLive = ["initiating", "sent_to_terminal", "waiting_customer", "processing", "reconnecting"].includes(state);
  const isFailedish = ["failed", "cancelled", "expired"].includes(state);
  const isPendingConfirmation = state === "long_running";

  const vivaTxUrl = vivaTxId
    ? (demoMode
      ? `https://demo.vivapayments.com/selfcareadmin/transactions?id=${encodeURIComponent(vivaTxId)}`
      : `https://www.vivapayments.com/selfcareadmin/transactions?id=${encodeURIComponent(vivaTxId)}`)
    : null;

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

          {state === "idle" && posReady === false && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <p className="text-xs leading-relaxed">
                Voer eerst Viva POS API credentials in voordat terminalbetalingen kunnen worden gebruikt.
                Ga naar Instellingen → GlowPay → Viva POS API credentials.
              </p>
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
                state === "long_running" ? <Clock className="w-7 h-7 text-warning shrink-0" /> :
                state === "waiting_customer" ? <Smartphone className="w-7 h-7 text-primary animate-pulse shrink-0" /> :
                <Loader2 className="w-7 h-7 animate-spin text-primary shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{state === "failed" && error ? error : STATE_LABELS[state]}</p>
                {state === "sent_to_terminal" && <p className="text-xs text-muted-foreground mt-0.5">Het pinapparaat ontvangt nu de transactie.</p>}
                {state === "waiting_customer" && <p className="text-xs text-muted-foreground mt-0.5">Geef het pinapparaat aan de klant. Tikken, swipen of pincode invoeren.</p>}
                {state === "processing" && <p className="text-xs text-muted-foreground mt-0.5">Even geduld — bank bevestigt de betaling.</p>}
                {state === "reconnecting" && <p className="text-xs text-muted-foreground mt-0.5">We controleren of het pinapparaat nog online is.</p>}
                {error && <p className="text-xs text-destructive mt-1">{error}</p>}
                {paymentId && <p className="text-[10px] text-muted-foreground mt-1">Ref: {paymentId.slice(0, 8)}…</p>}
              </div>
            </div>
          )}

          {isPendingConfirmation && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 p-3 flex items-start gap-2">
              <Clock className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-xs leading-relaxed space-y-1">
                <p className="font-semibold">Betaling wordt nog verwerkt</p>
                <p>Betaling ontvangen op terminal. We wachten nog op bevestiging van Viva. Je kunt dit venster sluiten — we werken de status automatisch bij zodra Viva bevestigt.</p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 flex-col sm:flex-row">
          {state === "idle" && (
            <>
              <Button variant="ghost" onClick={close} className="w-full sm:w-auto">Annuleer</Button>
              <Button onClick={startPayment} disabled={!selectedTerminal || terminals.length === 0 || posReady === false} className="w-full sm:w-auto">Start betaling</Button>
            </>
          )}
          {isLive && (
            <>
              {paymentId && (
                <Button variant="ghost" onClick={manualRefresh} disabled={manualChecking} className="w-full sm:w-auto">
                  {manualChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Status opnieuw controleren
                </Button>
              )}
              <Button variant="ghost" onClick={close} className="w-full sm:w-auto">Sluiten</Button>
            </>
          )}
          {isPendingConfirmation && (
            <>
              <Button variant="ghost" onClick={manualRefresh} disabled={manualChecking} className="w-full sm:w-auto">
                {manualChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                Status opnieuw controleren
              </Button>
              {vivaTxUrl && (
                <Button variant="ghost" asChild className="w-full sm:w-auto">
                  <a href={vivaTxUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" /> Bekijk transactie</a>
                </Button>
              )}
              <Button onClick={close} className="w-full sm:w-auto">Sluiten</Button>
            </>
          )}
          {isFailedish && (
            <>
              <Button variant="ghost" onClick={close} className="w-full sm:w-auto">Sluiten</Button>
              {paymentId && (
                <Button variant="ghost" onClick={manualRefresh} disabled={manualChecking} className="w-full sm:w-auto">
                  {manualChecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                  Status opnieuw controleren
                </Button>
              )}
              <Button onClick={retry} className="w-full sm:w-auto"><RotateCcw className="w-4 h-4" /> Opnieuw proberen</Button>
            </>
          )}
          {state === "paid" && (
            <>
              {vivaTxUrl && (
                <Button variant="ghost" asChild className="w-full sm:w-auto">
                  <a href={vivaTxUrl} target="_blank" rel="noreferrer"><ExternalLink className="w-4 h-4" /> Bekijk transactie</a>
                </Button>
              )}
              <Button onClick={close} className="w-full sm:w-auto">Klaar</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
