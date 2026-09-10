import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { FileText, Download } from "lucide-react";
import { toast } from "sonner";

interface DocInfo {
  salon_name: string;
  document_type: string;
  document_ref: string;
  format: string;
  expires_at: string;
  downloads_left: number;
}

const ERROR_TEXT: Record<string, string> = {
  expired: "Deze link is verlopen. Vraag de salon om een nieuwe link.",
  revoked: "Deze link is ingetrokken. Vraag de salon om een nieuwe link.",
  limit_reached: "Deze link is al het maximale aantal keer gebruikt.",
  rate_limited: "Te veel pogingen. Probeer het over een paar minuten opnieuw.",
};

export default function PublicDocumentPage() {
  const { token = "" } = useParams();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("Deze link is niet meer geldig.");
  const [info, setInfo] = useState<DocInfo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.functions.invoke("document-share", { body: { action: "get", token } });
      const res = data as (DocInfo & { error?: string }) | null;
      if (error || !res || res.error) {
        setMessage(ERROR_TEXT[res?.error ?? ""] || "Deze link is niet meer geldig. Vraag de salon om een nieuwe link.");
        setState("error");
        return;
      }
      setInfo(res);
      setState("ready");
    })();
  }, [token]);

  const download = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("document-share", { body: { action: "download", token } });
    setBusy(false);
    const res = data as { url?: string; error?: string } | null;
    if (error || !res?.url) {
      toast.error(ERROR_TEXT[res?.error ?? ""] || "Downloaden lukt nu niet. Probeer het later opnieuw.");
      return;
    }
    window.location.href = res.url;
  };

  if (state === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Laden...</div>;
  }

  if (state === "error") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="max-w-sm text-center space-y-2">
          <h1 className="text-xl font-semibold text-foreground">Link niet geldig</h1>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto w-full max-w-md space-y-6">
        <header className="space-y-2 text-center">
          <FileText className="h-7 w-7 text-primary mx-auto" />
          <h1 className="text-xl font-semibold text-foreground">
            {info?.salon_name} heeft een document met u gedeeld
          </h1>
          <p className="text-sm text-muted-foreground">{info?.document_type}</p>
        </header>

        <div className="rounded-2xl border border-border bg-card p-5 space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Soort</span>
            <span className="text-foreground">{info?.document_type}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bestand</span>
            <span className="text-foreground uppercase">{info?.format}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Beschikbaar tot</span>
            <span className="text-foreground">
              {info ? new Date(info.expires_at).toLocaleDateString("nl-NL", { dateStyle: "long" }) : "-"}
            </span>
          </div>
        </div>

        <Button className="w-full" size="lg" disabled={busy} onClick={download}>
          <Download className="h-4 w-4 mr-2" />
          {busy ? "Bezig..." : "Document downloaden"}
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          Deze link geeft alleen toegang tot dit ene document. Deel de link niet met anderen.
        </p>
      </div>
    </main>
  );
}
