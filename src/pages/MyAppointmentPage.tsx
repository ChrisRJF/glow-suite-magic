import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { CalendarCheck, FileText, Sparkles, Check, X } from "lucide-react";
import { toast } from "sonner";

interface PortalAppointment {
  id: string;
  appointment_date: string;
  start_time: string | null;
  status: string;
  confirmation_status: string;
  customer_name: string | null;
  service_name: string | null;
  expired: boolean;
}

interface PortalData {
  appointment: PortalAppointment;
  salon_name: string;
  forms: Array<{ id: string; title: string; status: string; open: boolean }>;
  documents: Array<{ document_type: string; created_at: string }>;
  aftercare: string | null;
  treatment_done: boolean;
}

const fmtDate = (iso: string, time: string | null) => {
  const d = new Date(iso);
  const date = d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  return time ? `${date} om ${time.slice(0, 5)}` : date;
};

export default function MyAppointmentPage() {
  const { token = "" } = useParams();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [data, setData] = useState<PortalData | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data: res, error } = await supabase.functions.invoke("appointment-confirm", {
      body: { action: "portal", token },
    });
    const payload = res as (PortalData & { error?: string }) | null;
    if (error || !payload || payload.error) {
      setState("error");
      return;
    }
    setData(payload);
    setState("ready");
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const respond = async (response: "confirm" | "decline") => {
    setBusy(true);
    const { data: res, error } = await supabase.functions.invoke("appointment-confirm", {
      body: { action: "respond", token, response },
    });
    setBusy(false);
    if (error || (res as { error?: string })?.error) {
      toast.error("Dit lukt nu niet. Probeer het later opnieuw.");
      return;
    }
    toast.success(response === "confirm" ? "Bedankt, uw afspraak staat vast." : "Uw afzegging is doorgegeven.");
    load();
  };

  const openForm = async (requestId: string) => {
    setBusy(true);
    const { data: res, error } = await supabase.functions.invoke("appointment-confirm", {
      body: { action: "form_link", token, request_id: requestId },
    });
    setBusy(false);
    const path = (res as { path?: string; error?: string } | null)?.path;
    if (error || !path) {
      toast.error("Dit formulier is niet meer beschikbaar. Vraag de salon om een nieuwe link.");
      return;
    }
    window.location.href = path;
  };

  if (state === "loading") {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Laden...</div>;
  }
  if (state === "error" || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <p className="text-muted-foreground">Deze link is niet meer geldig. Vraag de salon om een nieuwe link.</p>
      </div>
    );
  }

  const a = data.appointment;
  const openForms = data.forms.filter((f) => f.open);
  const cancelled = a.status === "geannuleerd" || a.status === "cancelled";

  return (
    <div className="min-h-screen bg-background px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-5">
        <header className="space-y-1 text-center">
          <p className="text-sm text-muted-foreground">{data.salon_name}</p>
          <h1 className="text-2xl font-semibold text-foreground">Uw afspraak</h1>
        </header>

        <section className="rounded-2xl border border-border bg-card p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <CalendarCheck className="h-4 w-4 text-primary" />
            {a.service_name || "Behandeling"}
          </div>
          <p className="text-sm text-muted-foreground">{fmtDate(a.appointment_date, a.start_time)}</p>
          <p className="text-xs text-muted-foreground">
            {cancelled
              ? "Deze afspraak is geannuleerd."
              : a.confirmation_status === "confirmed"
                ? "Bevestigd. Tot ziens."
                : a.confirmation_status === "declined"
                  ? "U heeft afgezegd."
                  : "Nog niet bevestigd."}
          </p>

          {!cancelled && !a.expired && a.confirmation_status === "pending" && (
            <div className="flex gap-2 pt-2">
              <Button className="flex-1" disabled={busy} onClick={() => respond("confirm")}>
                <Check className="mr-1 h-4 w-4" /> Ja, ik kom
              </Button>
              <Button variant="outline" className="flex-1" disabled={busy} onClick={() => respond("decline")}>
                <X className="mr-1 h-4 w-4" /> Afzeggen
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground">Wat er nog van u wordt gevraagd</h2>
          {openForms.length === 0 ? (
            <p className="text-sm text-muted-foreground">Niets meer. Alles staat klaar voor uw afspraak.</p>
          ) : (
            <ul className="space-y-2">
              {openForms.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm text-foreground">
                    <FileText className="h-4 w-4 text-primary" /> {f.title}
                  </span>
                  <Button size="sm" disabled={busy} onClick={() => openForm(f.id)}>
                    Invullen
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {data.aftercare && (
          <section className="rounded-2xl border border-border bg-card p-5 space-y-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" /> Nazorg
            </h2>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{data.aftercare}</p>
          </section>
        )}

        {data.documents.length > 0 && (
          <section className="rounded-2xl border border-border bg-card p-5 space-y-2">
            <h2 className="text-sm font-semibold text-foreground">Uw documenten</h2>
            {data.documents.map((d, i) => (
              <p key={i} className="text-sm text-muted-foreground">
                {d.document_type} van {new Date(d.created_at).toLocaleDateString("nl-NL", { dateStyle: "medium" })}
              </p>
            ))}
            <p className="text-xs text-muted-foreground">
              U ontvangt hiervoor een aparte beveiligde link van de salon.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
