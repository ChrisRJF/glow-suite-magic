import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CreditCard, Link2, CheckCircle2, FlaskConical } from "lucide-react";
import { formatEuro } from "@/lib/data";

type Step = "closed" | "choose" | "terminal" | "link" | "done";

/** Pure UI-simulatie. Doet geen enkele netwerkcall en wijzigt niets aan de afspraak. */
export function DemoCheckoutPanel({ appointmentId, price }: { appointmentId: string; price: number | null | undefined }) {
  const [step, setStep] = useState<Step>("closed");
  const [method, setMethod] = useState<"terminal" | "link">("terminal");
  useEffect(() => { setStep("closed"); }, [appointmentId]);

  if (step === "closed") {
    return <Button variant="outline" className="w-full" onClick={() => setStep("choose")}><FlaskConical className="w-4 h-4" /> Demo afrekenen (simulatie)</Button>;
  }
  const amount = Number(price) || 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Demo afrekenen</h3>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-muted-foreground">DEMO – geen echte betaling</span>
      </div>
      <dl className="text-sm"><div className="flex justify-between"><dt className="text-muted-foreground">Afspraakprijs (fictief afrekenen)</dt><dd className="font-semibold">{formatEuro(amount)}</dd></div></dl>
      <p className="text-xs text-muted-foreground">Dit is een simulatie. Er wordt niets betaald, opgeslagen of verstuurd, en de betaalstatus van deze afspraak verandert niet.</p>

      {step === "choose" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button onClick={() => { setMethod("terminal"); setStep("terminal"); }}><CreditCard className="w-4 h-4" /> Test pinbetaling</Button>
          <Button variant="outline" onClick={() => { setMethod("link"); setStep("link"); }}><Link2 className="w-4 h-4" /> Test betaallink</Button>
        </div>
      )}
      {step === "terminal" && (
        <div className="rounded-xl bg-secondary/60 p-3 text-sm space-y-3">
          <p>Testpinapparaat (gesimuleerd) wacht op betaling van {formatEuro(amount)}.</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setStep("done")}>Simuleer geslaagde betaling</Button>
            <Button size="sm" variant="ghost" onClick={() => setStep("choose")}>Annuleren</Button>
          </div>
        </div>
      )}
      {step === "link" && (
        <div className="rounded-xl bg-secondary/60 p-3 text-sm space-y-3">
          <p>Voorbeeld betaallink voor {formatEuro(amount)}. In de demo wordt geen echte link gemaakt of naar de klant verstuurd.</p>
          <p className="rounded-lg border border-dashed border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground select-none">betaallink-voorbeeld (demo)</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setStep("done")}>Simuleer geslaagde betaling</Button>
            <Button size="sm" variant="ghost" onClick={() => setStep("choose")}>Annuleren</Button>
          </div>
        </div>
      )}
      {step === "done" && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 rounded-xl bg-secondary/60 p-3 text-sm"><CheckCircle2 className="w-4 h-4 text-primary" /> Demo geslaagd (niet opgeslagen) via {method === "terminal" ? "testpinapparaat" : "testbetaallink"}.</p>
          <Button size="sm" variant="ghost" onClick={() => setStep("closed")}>Sluiten</Button>
        </div>
      )}
    </div>
  );
}
