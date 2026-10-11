import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CreditCard, Link2, Loader2, AlertTriangle, ExternalLink } from "lucide-react";
import { formatEuro } from "@/lib/data";
import { callCheckout, type CheckoutQuote } from "@/lib/appointmentCheckoutClient";
import { supabase } from "@/integrations/supabase/client";

type Terminal = { id: string; terminal_name: string; is_default?: boolean };

/** "Afrekenen" inside the appointment window. Shows server-computed amounts; never marks anything paid itself. */
export function AppointmentCheckoutPanel({ appointmentId }: { appointmentId: string }) {
  const [open, setOpen] = useState(false);
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [terminalId, setTerminalId] = useState<string>("");
  const [started, setStarted] = useState<{ method: "terminal" | "link"; amountCents: number; checkoutUrl: string | null } | null>(null);
  const inFlight = useRef(false);

  useEffect(() => { setOpen(false); setQuote(null); setError(null); setStarted(null); }, [appointmentId]);

  const load = async () => {
    setOpen(true); setBusy(true); setError(null);
    const [q, t] = await Promise.all([
      callCheckout({ action: "quote", appointment_id: appointmentId }),
      supabase.from("viva_terminals").select("id, terminal_name, is_default"),
    ]);
    if (q.ok === true) setQuote(q.quote); else { setQuote(q.quote ?? null); setError((q as { message: string }).message); }
    const list = ((t.data as Terminal[] | null) ?? []);
    setTerminals(list);
    setTerminalId((list.find((x) => x.is_default) ?? list[0])?.id ?? "");
    setBusy(false);
  };

  const start = async (method: "terminal" | "link") => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    const r = await callCheckout({ action: "start", appointment_id: appointmentId, method, ...(method === "terminal" ? { terminal_id: terminalId } : {}) });
    if (r.ok && r.started) setStarted({ method, amountCents: r.started.amountCents, checkoutUrl: r.started.checkoutUrl });
    else if (r.ok === false) setError((r as { message: string }).message);
    setBusy(false); inFlight.current = false;
  };

  if (!open) {
    return <Button className="w-full" onClick={load}><CreditCard className="w-4 h-4" /> Afrekenen</Button>;
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
      <h3 className="text-sm font-semibold">Afrekenen</h3>
      {busy && !quote && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Bedragen ophalen…</div>}
      {quote && (
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted-foreground">Afspraakbedrag</dt><dd>{formatEuro(quote.priceCents / 100)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted-foreground">Bevestigde aanbetaling</dt><dd>{formatEuro(quote.paidCents / 100)}</dd></div>
          <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><dt>Nog te betalen</dt><dd>{formatEuro(quote.dueCents / 100)}</dd></div>
        </dl>
      )}
      {error && <p className="flex gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{error}</p>}
      {started ? (
        <div className="rounded-xl bg-secondary/60 p-3 text-sm space-y-2">
          <p>{started.method === "terminal" ? "Betaling naar het pinapparaat gestuurd" : "Betaallink aangemaakt"} voor {formatEuro(started.amountCents / 100)}. De afspraak telt pas als betaald na bevestiging van de betaalprovider.</p>
          {started.checkoutUrl && <a href={started.checkoutUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">Betaallink openen <ExternalLink className="w-3.5 h-3.5" /></a>}
        </div>
      ) : quote && quote.dueCents > 0 && !error?.includes("volledig betaald") && (
        <div className="space-y-3">
          {terminals.length > 1 && (
            <select value={terminalId} onChange={(e) => setTerminalId(e.target.value)} className="w-full h-10 rounded-xl border border-border bg-background px-3 text-sm" aria-label="Pinapparaat">
              {terminals.map((t) => <option key={t.id} value={t.id}>{t.terminal_name}</option>)}
            </select>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button disabled={busy || !terminalId} onClick={() => start("terminal")}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />} Pinapparaat</Button>
            <Button variant="outline" disabled={busy} onClick={() => start("link")}><Link2 className="w-4 h-4" /> Betaallink</Button>
          </div>
        </div>
      )}
    </div>
  );
}
