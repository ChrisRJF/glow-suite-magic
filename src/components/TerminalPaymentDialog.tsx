import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useDemoMode } from "@/hooks/useDemoMode";
import { formatEuro } from "@/lib/data";
import { Loader2, CheckCircle2, XCircle, CreditCard } from "lucide-react";
import { toast } from "sonner";

type Terminal = { id: string; terminal_id: string; terminal_name: string; status: string; location_name: string | null };

type TerminalState = "idle" | "initiating" | "waiting" | "paid" | "failed" | "cancelled" | "expired";

const STATE_LABELS: Record<TerminalState, string> = {
  idle: "Klaar",
  initiating: "Terminal activeren…",
  waiting: "Wachten op klant — kaart aanbieden…",
  paid: "Betaling gelukt",
  failed: "Betaling mislukt",
  cancelled: "Geannuleerd",
  expired: "Verlopen",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  amountCents: number;
  description?: string;
  appointmentId?: string | null;
  customerId?: string | null;
  source?: "appointment" | "checkout" | "manual" | "auto_revenue" | "membership";
  onPaid?: (paymentId: string) => void;
}

export function TerminalPaymentDialog({
  open, onOpenChange, amountCents, description = "Terminal betaling",
  appointmentId = null, customerId = null, source = "manual", onPaid,
}: Props) {
  const { demoMode } = useDemoMode();
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [selectedTerminal, setSelectedTerminal] = useState<string>("");
  const [state, setState] = useState<TerminalState>("idle");
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setState("idle"); setPaymentId(null); setError(null);
    (async () => {
      const { data } = await supabase.from("viva_terminals").select("id,terminal_id,terminal_name,status,location_name").eq("status", "active");
      setTerminals((data as any) || []);
      if (data && data.length === 1) setSelectedTerminal((data[0] as any).terminal_id);
    })();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [open]);

  const startPayment = async () => {
    if (!selectedTerminal) { toast.error("Selecteer een terminal"); return; }
    setState("initiating"); setError(null);
    const { data, error: err } = await supabase.functions.invoke("create-viva-terminal-payment", {
      body: { terminal_id: selectedTerminal, amount_cents: amountCents, description, appointment_id: appointmentId, customer_id: customerId, source, is_demo: demoMode },
    });
    if (err || (data as any)?.error) {
      setState("failed"); setError((data as any)?.detail || (data as any)?.error || err?.message || "Onbekende fout");
      return;
    }
    const pid = (data as any).payment_id as string;
    setPaymentId(pid); setState("waiting");

    const start = Date.now();
    pollRef.current = window.setInterval(async () => {
      if (Date.now() - start > 90_000) {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setState((s) => (s === "waiting" ? "expired" : s));
        return;
      }
      const { data: st } = await supabase.functions.invoke("viva-terminal-payment-status", { body: { payment_id: pid } });
      const status = (st as any)?.status;
      if (status === "paid") {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setState("paid"); onPaid?.(pid);
        toast.success("Betaling gelukt");
      } else if (status === "failed" || status === "cancelled" || status === "expired") {
        if (pollRef.current) window.clearInterval(pollRef.current);
        setState(status as TerminalState);
      }
    }, 2500);
  };

  const close = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) close(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CreditCard className="w-4 h-4 text-primary" /> Betaal op terminal</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-xl bg-secondary/40 p-4 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Te betalen</span>
            <span className="text-2xl font-bold">{formatEuro(amountCents / 100)}</span>
          </div>

          {state === "idle" && (
            <div>
              <label className="text-xs text-muted-foreground">Terminal</label>
              {terminals.length === 0 ? (
                <p className="text-xs text-destructive mt-1">Geen actieve terminals. Voeg er één toe in Instellingen → GlowPay.</p>
              ) : (
                <select value={selectedTerminal} onChange={(e) => setSelectedTerminal(e.target.value)} className="w-full mt-1 px-3 py-2 rounded-xl bg-background border border-border text-sm">
                  <option value="">Selecteer terminal…</option>
                  {terminals.map((t) => (
                    <option key={t.id} value={t.terminal_id}>{t.terminal_name}{t.location_name ? ` — ${t.location_name}` : ""}</option>
                  ))}
                </select>
              )}
            </div>
          )}

          {state !== "idle" && (
            <div className="rounded-xl border border-border p-4 flex items-center gap-3">
              {state === "paid" ? <CheckCircle2 className="w-6 h-6 text-success" /> :
                state === "failed" || state === "cancelled" || state === "expired" ? <XCircle className="w-6 h-6 text-destructive" /> :
                <Loader2 className="w-6 h-6 animate-spin text-primary" />}
              <div>
                <p className="text-sm font-medium">{STATE_LABELS[state]}</p>
                {error && <p className="text-xs text-destructive mt-1">{error}</p>}
                {paymentId && <p className="text-[10px] text-muted-foreground mt-1">Betaling: {paymentId.slice(0, 8)}…</p>}
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          {state === "idle" && (
            <>
              <Button variant="ghost" onClick={close}>Annuleer</Button>
              <Button onClick={startPayment} disabled={!selectedTerminal || terminals.length === 0}>Start betaling</Button>
            </>
          )}
          {state === "waiting" && <Button variant="ghost" onClick={close}>Sluiten</Button>}
          {(state === "paid" || state === "failed" || state === "cancelled" || state === "expired") && (
            <Button onClick={close}>Sluiten</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
