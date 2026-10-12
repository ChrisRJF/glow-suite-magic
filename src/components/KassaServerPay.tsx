import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Smartphone, Check, Loader2, GraduationCap } from "lucide-react";
import { formatEuro } from "@/lib/data";
import { payWithKassa, practiceWithKassa, loadSaved, type KassaLine, type KassaState, type KassaServerDeps, type PracticeResult } from "@/lib/kassaServer";

const safeStorage = () => { try { return window.localStorage; } catch { return null; } };
// How long a confirmed success stays visible before the screen resets to a clean sale.
const SUCCESS_RESET_MS = 4000;

export const kassaServerDeps: KassaServerDeps = {
  createOrder: async (requestId, customerId, lines, demo) => {
    const { data, error } = await (supabase.rpc as any)("kassa_create_order", { _request_id: requestId, _customer_id: customerId, _lines: lines, _demo: demo });
    if (error) throw error;
    return data;
  },
  startPayment: async (orderId, terminalId) => {
    const { data, error } = await supabase.functions.invoke("kassa-checkout", { body: { order_id: orderId, terminal_id: terminalId } });
    const ctx = (error as any)?.context;
    if (error && ctx?.json) { const body = await ctx.json().catch(() => ({})); return { status: ctx.status ?? 500, body }; }
    if (error) throw error;
    return { status: 200, body: data };
  },
  pollStatus: async (paymentId) => {
    for (let i = 0; i < 60; i++) {
      const { data } = await supabase.functions.invoke("viva-terminal-payment-status", { body: { payment_id: paymentId } });
      const s = (data as any)?.status;
      if (["paid", "failed", "cancelled", "expired"].includes(s)) return s;
      await new Promise((r) => setTimeout(r, 3000));
    }
    return null;
  },
};

export const kassaPracticeCheckout = async (requestId: string, customerId: string | null, lines: KassaLine[]): Promise<PracticeResult> => {
  const { data, error } = await (supabase.rpc as any)("kassa_practice_checkout", { _request_id: requestId, _customer_id: customerId, _lines: lines });
  if (error) throw error;
  return data;
};

type Props = {
  userId: string; demo: boolean; customerId: string | null; lines: KassaLine[]; onPaid: () => void; onNewSale?: () => void;
  onLockChange: (locked: boolean) => void; deps?: KassaServerDeps;
  practice?: boolean; practiceCheckout?: typeof kassaPracticeCheckout;
};

export function KassaServerPay({ userId, demo, customerId, lines, onPaid, onNewSale, onLockChange, deps = kassaServerDeps, practice = false, practiceCheckout = kassaPracticeCheckout }: Props) {
  const [terminals, setTerminals] = useState<Array<{ id: string; name: string | null }>>([]);
  const [terminalId, setTerminalId] = useState("");
  const [state, setState] = useState<KassaState>({ phase: "idle" });
  const busy = useRef(false);
  const resetTimer = useRef<number | undefined>(undefined);
  // Practice: one request id per sale (component remounts per sale), so a retry never creates a second order.
  const practiceReq = useRef<{ id: string; key: string } | null>(null);
  const [hasOpen, setHasOpen] = useState(() => !practice && !!loadSaved(safeStorage(), userId)?.paymentId);

  useEffect(() => {
    if (practice) return;
    supabase.from("viva_terminals").select("id, terminal_name, is_default").eq("is_demo", demo).eq("status", "active").then(({ data }) => {
      const rows = (data ?? []) as Array<{ id: string; terminal_name: string | null; is_default: boolean | null }>;
      const t = rows.map((r) => ({ id: r.id, name: r.terminal_name, is_default: !!r.is_default }));
      setTerminals(t); const pick = t.find((x) => x.is_default) ?? t[0]; if (pick) setTerminalId(pick.id);
    });
  }, [demo, practice]);

  useEffect(() => { onLockChange(hasOpen || ["creating", "starting", "open", "paid"].includes(state.phase)); }, [hasOpen, state.phase, onLockChange]);
  useEffect(() => () => { if (resetTimer.current) window.clearTimeout(resetTimer.current); }, []);

  const pay = async () => {
    if (busy.current || state.phase === "paid") return; // double click guard; a paid order is never paid again
    busy.current = true;
    try {
      let r: KassaState;
      if (practice) {
        const key = JSON.stringify([customerId, lines]);
        if (!practiceReq.current || practiceReq.current.key !== key) practiceReq.current = { id: crypto.randomUUID(), key };
        r = await practiceWithKassa({ requestId: practiceReq.current.id, customerId, lines }, practiceCheckout, setState);
      } else {
        r = await payWithKassa({ storage: safeStorage(), userId, customerId, lines, demo, terminalId }, deps, setState);
        setHasOpen(!!loadSaved(safeStorage(), userId)?.paymentId);
      }
      if (r.phase === "paid") {
        onPaid();
        // Only a server/provider-confirmed payment resets; pending/failed/uncertain never do.
        resetTimer.current = window.setTimeout(() => onNewSale?.(), SUCCESS_RESET_MS);
      }
    } finally { busy.current = false; }
  };

  const working = ["creating", "starting", "open"].includes(state.phase);
  return (
    <div className="space-y-3">
      {practice ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-primary"><GraduationCap className="w-3.5 h-3.5" /> Oefenmodus: geen echte betaling, omzet of voorraad.</p>
      ) : (<>
        {demo && <p className="text-xs font-medium text-primary">Demo afrekenen: geen echte betaling, omzet of voorraad.</p>}
        <div>
          <label className="text-xs text-muted-foreground">Pinapparaat</label>
          <select aria-label="Pinapparaat" value={terminalId} disabled={working || hasOpen} onChange={(e) => setTerminalId(e.target.value)}
            className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm">
            {terminals.length === 0 && <option value="">Geen actief pinapparaat</option>}
            {terminals.map((t) => <option key={t.id} value={t.id}>{t.name || "Pinapparaat"}</option>)}
          </select>
        </div>
      </>)}
      {state.phase === "paid" ? (
        <div role="status" className="rounded-xl bg-secondary/40 p-3">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 text-success" />
            <span className="font-medium text-success">{practice ? "Demo betaald" : "Betaling geslaagd"}</span>
          </div>
          {state.totalCents ? <p className="text-xs text-muted-foreground mt-1">{formatEuro(state.totalCents / 100)} {practice ? "geoefend" : "ontvangen"}</p> : null}
        </div>
      ) : state.phase !== "idle" && (
        <div role="status" className="rounded-xl bg-secondary/40 p-3 text-xs text-muted-foreground">
          {state.phase === "creating" && (practice ? "Oefenbestelling wordt afgerond..." : "Bestelling wordt gecontroleerd...")}
          {state.phase === "starting" && "Betaling wordt gestart op het pinapparaat..."}
          {state.phase === "open" && <>Betaling staat open{state.totalCents ? ` (${formatEuro(state.totalCents / 100)})` : ""}. Wacht op het pinapparaat.</>}
          {(state.phase === "failed" || state.phase === "error") && <span className="text-destructive">{state.message}</span>}
        </div>
      )}
      <Button type="button" className="w-full" size="lg" onClick={pay} disabled={working || state.phase === "paid" || (!practice && !terminalId) || lines.length === 0}>
        {working ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : state.phase === "paid" ? <Check className="w-4 h-4 mr-2" /> : practice ? <GraduationCap className="w-4 h-4 mr-2" /> : <Smartphone className="w-4 h-4 mr-2" />}
        {practice
          ? (state.phase === "paid" ? "Demo betaald" : state.phase === "error" ? "Opnieuw proberen" : "Oefenbetaling afronden")
          : (state.phase === "paid" ? "Betaald" : hasOpen ? "Openstaande betaling bekijken" : state.phase === "failed" ? "Opnieuw proberen" : "Betaal op pinapparaat")}
      </Button>
    </div>
  );
}
