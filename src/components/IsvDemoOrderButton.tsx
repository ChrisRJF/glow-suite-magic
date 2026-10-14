// TEMPORARY: one-click Viva ISV demo order for the platform owner. Remove after the demo test.
// All checks (platform owner, aal2, switch, merchant, amounts) are enforced server-side.
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const isPreviewHost = () => {
  const h = window.location.hostname;
  return h === "localhost" || h.startsWith("id-preview--") || h.endsWith(".lovableproject.com");
};

const MESSAGES: Record<string, string> = {
  unauthenticated: "Je bent niet ingelogd.",
  forbidden: "Dit account heeft geen toegang.",
  mfa_required: "Log opnieuw in en vul je verificatiecode in.",
  isv_demo_disabled: "De testschakelaar staat uit. Er is geen order aangemaakt.",
  previous_attempt_needs_review: "Er is al een eerdere poging. Er is geen nieuwe order aangemaakt.",
};

export function IsvDemoOrderButton() {
  const [clicked, setClicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string; link?: string } | null>(null);

  if (!isPreviewHost()) return null;

  const run = async () => {
    if (clicked) return;
    setClicked(true); setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("viva-isv-demo-order", { body: {} });
      if (error) {
        let code = "";
        try { code = (await (error as any).context?.json())?.error ?? ""; } catch { /* noop */ }
        setResult({ ok: false, text: MESSAGES[code] ?? "De aanvraag is mislukt of de uitkomst is onbekend. Probeer niet opnieuw; laat het eerst controleren." });
      } else if (data?.order_code) {
        setResult({ ok: true, text: `Order ${data.order_code}${data.reused ? " (bestaande order)" : ""}`, link: data.checkout_url ?? `https://demo.vivapayments.com/web/checkout?ref=${data.order_code}` });
      } else {
        setResult({ ok: false, text: "Onbekende uitkomst. Probeer niet opnieuw; laat het eerst controleren." });
      }
    } catch {
      setResult({ ok: false, text: "Geen antwoord ontvangen. Probeer niet opnieuw; laat het eerst controleren." });
    } finally { setBusy(false); }
  };

  return (
    <div className="glass-card space-y-3 p-5">
      <h3 className="text-sm font-semibold">Viva ISV-demotest (tijdelijk)</h3>
      <p className="text-sm text-muted-foreground">Eén demo-order van € 1,00. Werkt alleen voor de platformeigenaar met verificatiecode.</p>
      <Button onClick={run} disabled={clicked}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Maak ISV-demo-order
      </Button>
      {result && (
        <p className={result.ok ? "text-sm" : "text-sm text-destructive"}>
          {result.text}
          {result.link && <> · <a href={result.link} target="_blank" rel="noopener noreferrer" className="text-primary underline">Open checkout</a></>}
        </p>
      )}
    </div>
  );
}
