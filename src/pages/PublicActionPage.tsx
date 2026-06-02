import { Button } from "@/components/ui/button";
import { CalendarDays, FileText, MapPin, MessageSquare, ReceiptText, Settings } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLanguagePersistence } from "@/hooks/useLanguagePersistence";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const sectionIcons: Record<string, typeof CalendarDays> = {
  afspraak: Settings,
  "route-contact": MapPin,
  salonvoorwaarden: FileText,
  betaalbewijs: ReceiptText,
  "abonnement-beheren": CalendarDays,
  review: MessageSquare,
};

export default function PublicActionPage() {
  useLanguagePersistence();
  const { t } = useTranslation();
  const location = useLocation();
  const params = useParams();
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
      </section>
    </main>
  );
}
