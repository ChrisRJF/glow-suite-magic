import { Button } from "@/components/ui/button";
import { CalendarDays, FileText, MapPin, MessageSquare, ReceiptText, Settings } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";

const pageContent: Record<string, { title: string; text: string; icon: typeof CalendarDays }> = {
  afspraak: { title: "Afspraak beheren", text: "Deze beveiligde beheerlink is ontvangen. Neem contact op met de salon als je je afspraak wilt wijzigen.", icon: Settings },
  "route-contact": { title: "Route en contact", text: "Bekijk de contactgegevens van de salon of neem direct contact op voor route-informatie.", icon: MapPin },
  salonvoorwaarden: { title: "Salonvoorwaarden", text: "Op afspraken gelden de voorwaarden van de salon, zoals tijdig wijzigen of annuleren en eventuele betaalafspraken.", icon: FileText },
  betaalbewijs: { title: "Betaalbewijs", text: "Je betaalbewijs is gekoppeld aan je afspraak of bestelling. Bewaar de e-mail als referentie.", icon: ReceiptText },
  "abonnement-beheren": { title: "Abonnement beheren", text: "Je abonnement is gekoppeld aan de salon. Neem contact op met de salon voor wijzigingen of vragen.", icon: CalendarDays },
  review: { title: "Review schrijven", text: "Bedankt dat je je ervaring wilt delen. Je feedback helpt de salon om de service nog beter te maken.", icon: MessageSquare },
};

export default function PublicActionPage() {
  const location = useLocation();
  const params = useParams();
  const section = (params.section || location.pathname.split("/").filter(Boolean)[0] || "afspraak").toLowerCase();
  const content = pageContent[section] || pageContent.afspraak;
  const Icon = content.icon;

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <section className="w-full max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
          <Icon className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">{content.title}</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">{content.text}</p>
        {section === "salonvoorwaarden" && (
          <div className="mt-5 rounded-xl border border-border bg-secondary/30 p-4 text-left text-sm text-muted-foreground">
            <p>• Kom op tijd voor je afspraak.</p>
            <p>• Wijzig of annuleer zo vroeg mogelijk.</p>
            <p>• Bij te laat annuleren kunnen kosten gelden.</p>
          </div>
        )}
        <Button asChild variant="gradient" className="mt-6">
          <Link to="/boeken">Nieuwe afspraak boeken</Link>
        </Button>
      </section>
    </main>
  );
}