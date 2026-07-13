import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CalendarDays, FileText, MapPin, MessageSquare, ReceiptText, Settings, CheckCircle2, XCircle, AlertTriangle, Loader2 } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLanguagePersistence } from "@/hooks/useLanguagePersistence";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useEnforceSalonLanguage } from "@/i18n/useEnforceSalonLanguage";
import { readSalonLanguageConfig } from "@/i18n/salonLanguageCache";
import { supabase } from "@/integrations/supabase/client";

const sectionIcons: Record<string, typeof CalendarDays> = {
  afspraak: Settings,
  "route-contact": MapPin,
  salonvoorwaarden: FileText,
  betaalbewijs: ReceiptText,
  "abonnement-beheren": CalendarDays,
  review: MessageSquare,
};

interface PublicAppointment {
  id: string;
  appointment_date: string;
  start_time: string | null;
  status: string;
  confirmation_status: "pending" | "confirmed" | "declined";
  confirmation_responded_at: string | null;
  customer_name: string | null;
  service_name: string | null;
  expired: boolean;
}

function formatWhen(iso: string, startTime: string | null): string {
  try {
    const date = new Date(iso);
    const datePart = date.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
    const timePart = (startTime || date.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })).slice(0, 5);
    return `${datePart} om ${timePart}`;
  } catch {
    return iso;
  }
}

function ConfirmationView({ token, initialAction }: { token: string; initialAction?: string }) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appt, setAppt] = useState<PublicAppointment | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase.functions.invoke("appointment-confirm", {
        body: { action: "get", token },
      });
      if (cancelled) return;
      if (err || !data?.appointment) {
        setError(data?.error === "invalid_token" ? "invalid" : "invalid");
      } else {
        setAppt(data.appointment as PublicAppointment);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const respond = async (response: "confirm" | "decline") => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const { data, error: err } = await supabase.functions.invoke("appointment-confirm", {
      body: { action: "respond", token, response },
    });
    if (err) {
      setError("network");
    } else if (data?.error === "expired") {
      setAppt(data.appointment as PublicAppointment);
      setError("expired");
    } else if (data?.error) {
      setError("network");
    } else if (data?.appointment) {
      setAppt(data.appointment as PublicAppointment);
    }
    setSubmitting(false);
  };

  // Auto-trigger from /afspraak/:token/bevestigen or /annuleren links (email/WhatsApp direct actions)
  useEffect(() => {
    if (!appt || appt.expired || appt.confirmation_status !== "pending" || !initialAction) return;
    const normalized = initialAction.toLowerCase();
    if (["bevestigen", "confirm", "ik-kom"].includes(normalized)) {
      respond("confirm");
    } else if (["annuleren", "decline", "cancel", "ik-kan-niet"].includes(normalized)) {
      respond("decline");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appt?.id]);

  if (loading) {
    return (
      <div className="w-full max-w-md text-center">
        <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Afspraak laden…</p>
      </div>
    );
  }

  if (!appt || error === "invalid") {
    return (
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10">
          <AlertTriangle className="h-5 w-5 text-destructive" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Deze link is niet meer geldig</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Neem contact op met de salon als je je afspraak wilt bevestigen of wijzigen.
        </p>
      </div>
    );
  }

  if (appt.expired || error === "expired") {
    return (
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <AlertTriangle className="h-5 w-5 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Deze afspraak is al verlopen</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Boek eenvoudig een nieuwe afspraak wanneer het jou uitkomt.
        </p>
        <Button asChild variant="gradient" className="mt-6">
          <Link to="/boeken">Nieuwe afspraak boeken</Link>
        </Button>
      </div>
    );
  }

  if (appt.confirmation_status === "confirmed") {
    return (
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100 dark:bg-emerald-900/40">
          <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Bedankt! We zien je binnenkort.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Je afspraak {appt.service_name ? `voor ${appt.service_name} ` : ""}op {formatWhen(appt.appointment_date, appt.start_time)} is bevestigd.
        </p>
      </div>
    );
  }

  if (appt.confirmation_status === "declined") {
    return (
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <XCircle className="h-6 w-6 text-muted-foreground" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Bedankt voor je reactie.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          We hebben je afzegging ontvangen. Boek gerust een nieuwe afspraak wanneer het uitkomt.
        </p>
        <Button asChild variant="gradient" className="mt-6">
          <Link to="/boeken">Nieuwe afspraak boeken</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-md text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
        <CalendarDays className="h-5 w-5 text-primary" />
      </div>
      <h1 className="text-2xl font-semibold text-foreground">
        {appt.customer_name ? `Hoi ${appt.customer_name}` : "Bevestig je afspraak"}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Kun je bij je afspraak {appt.service_name ? `voor ${appt.service_name} ` : ""}
        op <span className="font-medium text-foreground">{formatWhen(appt.appointment_date, appt.start_time)}</span> zijn?
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Button variant="gradient" disabled={submitting} onClick={() => respond("confirm")}>
          {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
          Ja, ik kom
        </Button>
        <Button variant="outline" disabled={submitting} onClick={() => respond("decline")}>
          <XCircle className="mr-2 h-4 w-4" />
          Nee, ik kan niet komen
        </Button>
      </div>
      {error === "network" && (
        <p className="mt-4 text-xs text-destructive">Het lukte niet om je reactie op te slaan. Probeer opnieuw.</p>
      )}
    </div>
  );
}

export default function PublicActionPage() {
  useLanguagePersistence();
  const { t } = useTranslation();
  const location = useLocation();
  const params = useParams();
  const { allowedLanguages, showSwitcher } = useEnforceSalonLanguage(readSalonLanguageConfig());

  const isAppointmentToken = Boolean(params.token) && location.pathname.startsWith("/afspraak/");

  const section = (params.section || location.pathname.split("/").filter(Boolean)[0] || "afspraak").toLowerCase();
  const knownSection = sectionIcons[section] ? section : "afspraak";
  const Icon = sectionIcons[knownSection];
  const title = t(`publicAction.${knownSection}.title`);
  const text = t(`publicAction.${knownSection}.text`);
  const bullets = knownSection === "salonvoorwaarden"
    ? (t("publicAction.salonvoorwaarden.bullets", { returnObjects: true }) as string[])
    : [];

  return (
    <main className="min-h-screen bg-background flex flex-col p-6">
      <div className="w-full flex justify-end"><LanguageSwitcher allowedLanguages={allowedLanguages} hidden={!showSwitcher} /></div>
      <section className="flex-1 flex items-center justify-center">
        {isAppointmentToken ? (
          <ConfirmationView token={params.token as string} initialAction={params.action} />
        ) : (
          <div className="w-full max-w-md text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Icon className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{text}</p>
            {bullets.length > 0 && (
              <div className="mt-5 rounded-xl border border-border bg-secondary/30 p-4 text-left text-sm text-muted-foreground">
                {bullets.map((b, i) => <p key={i}>• {b}</p>)}
              </div>
            )}
            <Button asChild variant="gradient" className="mt-6">
              <Link to="/boeken">{t("common.newBooking")}</Link>
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}
