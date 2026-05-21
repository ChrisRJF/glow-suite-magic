import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Calendar, CreditCard, Repeat, Users, Sparkles, BarChart3,
  Zap, Globe, Shield,
  CheckCircle2, ArrowRight, Menu, X, Star, Clock, TrendingUp,
  Smartphone, Lock, Brain, Bot, Wand2, LineChart, Bell, Target,
  AlertTriangle, MessageCircle, UserCheck, MoveRight, Heart, Coins, ShieldCheck,
} from "lucide-react";
import { GlowSuiteLogo } from "@/components/GlowSuiteLogo";
import { DemoRequestDialog } from "@/components/DemoRequestDialog";
import { MigrationHelpDialog } from "@/components/MigrationHelpDialog";
import { TestimonialsSection } from "@/components/TestimonialsSection";
import { RoiCalculator } from "@/components/RoiCalculator";
import { useTrackOnMount } from "@/hooks/useAnalytics";
import { DirectCheckoutDialog } from "@/components/DirectCheckoutDialog";
import shotDashboard from "@/assets/landing/dashboard.png";
import shotAgenda from "@/assets/landing/agenda.png";
import shotBetalingen from "@/assets/landing/betalingen.png";

import shotRapportage from "@/assets/landing/rapportage.png";
import heroPhones from "@/assets/glowsuite-hero-phones.png";

const SIGNUP = "/login?mode=signup";
const LOGIN = "/login";

function Section({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`w-full px-5 sm:px-8 py-10 sm:py-16 lg:py-20 ${className}`}>
      <div className="max-w-6xl mx-auto">{children}</div>
    </section>
  );
}

function Eyebrow({ children, icon: Icon = Sparkles }: { children: React.ReactNode; icon?: any }) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide uppercase mb-4">
      <Icon className="w-3.5 h-3.5" />
      {children}
    </div>
  );
}

function MockWindow({ url, children }: { url: string; children: React.ReactNode }) {
  return (
    <div
      className="relative rounded-2xl border border-border/70 bg-card overflow-hidden"
      style={{ boxShadow: "0 24px 60px -24px hsl(var(--primary) / 0.22)" }}
    >
      <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-border/60 bg-muted/40">
        <span className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
        <span className="w-2.5 h-2.5 rounded-full bg-warning/60" />
        <span className="w-2.5 h-2.5 rounded-full bg-success/60" />
        <span className="ml-3 text-[11px] sm:text-xs text-muted-foreground truncate">{url}</span>
      </div>
      <div className="bg-gradient-to-br from-background to-muted/30">{children}</div>
    </div>
  );
}

function Shot({ src, alt }: { src: string; alt: string }) {
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="block w-full h-auto select-none"
      draggable={false}
    />
  );
}

/**
 * Realistic iPhone frame, pure CSS. Wraps any image/screenshot.
 * Use a portrait-friendly screenshot (will be cover-cropped).
 */
function IPhoneFrame({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <div
        className="relative mx-auto"
        style={{
          width: "min(280px, 78vw)",
          aspectRatio: "9 / 19",
        }}
      >
        {/* Outer frame */}
        <div
          className="absolute inset-0 rounded-[2.6rem] bg-[#0b0b0d] p-[10px]"
          style={{
            boxShadow:
              "0 30px 60px -20px hsl(var(--primary) / 0.25), 0 8px 24px -8px rgba(0,0,0,0.35), inset 0 0 0 1.5px rgba(255,255,255,0.08)",
          }}
        >
          {/* Screen */}
          <div className="relative h-full w-full overflow-hidden rounded-[2.1rem] bg-background">
            <img
              src={src}
              alt={alt}
              loading="lazy"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover object-top select-none"
            />
            {/* Dynamic island */}
            <div className="absolute top-2.5 left-1/2 -translate-x-1/2 h-6 w-[38%] rounded-full bg-black z-10" />
          </div>
        </div>
        {/* Side buttons */}
        <span className="absolute -left-[3px] top-[22%] h-10 w-[3px] rounded-l-md bg-[#1a1a1c]" />
        <span className="absolute -left-[3px] top-[34%] h-14 w-[3px] rounded-l-md bg-[#1a1a1c]" />
        <span className="absolute -right-[3px] top-[28%] h-16 w-[3px] rounded-r-md bg-[#1a1a1c]" />
      </div>
      {caption && (
        <div className="mt-4 text-xs sm:text-sm text-muted-foreground text-center max-w-[16rem]">
          {caption}
        </div>
      )}
    </div>
  );
}

function CTAButton({
  to, variant = "gradient", size = "lg", children, className = "",
}: {
  to: string;
  variant?: "gradient" | "outline" | "default";
  size?: "lg" | "default" | "sm";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link to={to} className={`w-full sm:w-auto max-w-full ${className}`}>
      <Button
        variant={variant as any}
        size={size}
        className="w-full sm:w-auto max-w-full whitespace-normal break-words text-center leading-tight px-5"
      >
        {children}
      </Button>
    </Link>
  );
}

function CTADemoRequest({
  onClick, variant = "outline", size = "lg", children, className = "",
}: {
  onClick: () => void;
  variant?: "gradient" | "outline" | "default";
  size?: "lg" | "default" | "sm";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`w-full sm:w-auto max-w-full ${className}`}>
      <Button
        type="button"
        onClick={onClick}
        variant={variant as any}
        size={size}
        className="w-full sm:w-auto max-w-full whitespace-normal break-words text-center leading-tight px-5"
      >
        {children}
      </Button>
    </div>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [showStickyCta, setShowStickyCta] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoSource, setDemoSource] = useState<string>("landing");
  const openDemo = (source: string) => { setDemoSource(source); setDemoOpen(true); };
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationSource, setMigrationSource] = useState<string>("migration-help");
  const openMigration = (source: string) => { setMigrationSource(source); setMigrationOpen(true); };
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState<{ slug: string; name: string; price: string } | null>(null);
  const openCheckout = (slug: string, name: string, price: string) => {
    setCheckoutPlan({ slug, name, price });
    setCheckoutOpen(true);
  };

  useTrackOnMount("landing_visit");

  useEffect(() => {
    document.documentElement.classList.add("light");
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled(y > 8);
      setShowStickyCta(y > 600);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollToPricing = (e: React.MouseEvent) => {
    e.preventDefault();
    const el = document.getElementById("prijzen");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const problems = [
    { icon: Calendar, t: "Gaten in je agenda kosten omzet" },
    { icon: Bell, t: "Klanten vergeten hun afspraken" },
    { icon: Clock, t: "Te veel handmatig werk" },
    { icon: BarChart3, t: "Geen overzicht in je cijfers" },
    { icon: Repeat, t: "Geen slimme klantopvolging" },
    { icon: Globe, t: "Losse tools die tijd opslokken" },
  ];

  const valueCards = [
    { icon: Calendar, title: "24/7 online boekingen", desc: "Klanten boeken zelf, ook 's avonds en in het weekend." },
    { icon: Bot, title: "Automatische herinneringen", desc: "Minder no-shows, zonder dat jij appjes hoeft te sturen." },
    { icon: CreditCard, title: "Aanbetalingen via Mollie", desc: "Meer zekerheid vooraf bij nieuwe en risicoklanten." },
    { icon: Repeat, title: "Abonnementen", desc: "Terugkerende maandinkomsten met automatische incasso." },
    { icon: TrendingUp, title: "Slimme klantopvolging", desc: "Vaste klanten krijgen op tijd een nieuw voorstel." },
    { icon: LineChart, title: "Realtime inzicht", desc: "Zie direct waar omzet blijft liggen in je salon." },
  ];

  const aiBlocks = [
    { icon: Wand2, t: "Vult lege plekken op het juiste moment", d: "GlowSuite herkent dalmomenten en stelt passende vaste klanten voor." },
    { icon: Users, t: "Herkent klanten die toe zijn aan een nieuwe afspraak", d: "Persoonlijke voorstellen op het juiste moment, zonder handmatig zoekwerk." },
    { icon: Target, t: "Geeft concrete omzetkansen aan", d: "Herboekingen, upsells en winback klaar om met één tik te versturen." },
    { icon: Zap, t: "Minder handmatig opvolgen", d: "Bevestigingen, reminders en betalingen gaan automatisch." },
    { icon: Brain, t: "Eén plek voor je dag", d: "Geen losse appjes en notities meer. Alleen wat vandaag aandacht vraagt." },
  ];

  const trustItems = [
    { icon: CreditCard, label: "Veilige betalingen via Mollie" },
    { icon: Lock, label: "AVG-bewust gebouwd" },
    { icon: Globe, label: "White-label boekingspagina" },
    { icon: Smartphone, label: "Werkt mobiel perfect" },
    { icon: Shield, label: "Slimme support" },
    { icon: Brain, label: "Moderne AI technologie" },
  ];

  const plans = [
    {
      slug: "starter",
      name: "Starter",
      price: "€39",
      tagline: "Voor solo professionals die net beginnen.",
      featured: false,
      requiresDemo: false,
      features: [
        "Online agenda & boekingen",
        "Klantendatabase",
        "WhatsApp herinneringen",
        "1 medewerker",
        "Basis rapportages",
      ],
    },
    {
      slug: "growth",
      name: "Growth",
      price: "€79",
      tagline: "Voor groeiende salons die meer omzet willen halen.",
      featured: true,
      requiresDemo: false,
      features: [
        "Alles uit Starter",
        "Tot 5 medewerkers",
        "GlowPay online betalingen",
        "Cadeaubonnen & memberships",
        "Slimme omzet-inzichten",
        "Marketing automations",
      ],
    },
    {
      slug: "premium",
      name: "Premium",
      price: "€129",
      tagline: "Voor salons met meerdere vestigingen en hoge volumes.",
      featured: false,
      requiresDemo: true,
      features: [
        "Alles uit Growth",
        "Onbeperkt medewerkers",
        "Multi-vestiging",
        "White-label boekingspagina",
        "Auto Revenue Engine",
        "Persoonlijke onboarding",
      ],
    },
  ];

  const faqs = [
    { q: "Is GlowSuite geschikt voor kleine salons?", a: "Ja. GlowSuite werkt voor solo-professionals én teams. Je betaalt alleen voor wat je nodig hebt en je kunt op elk moment opschalen." },
    { q: "Hoe werkt de AI van GlowSuite precies?", a: "GlowSuite kijkt rustig mee in je agenda, klanten en betalingen. Op het juiste moment komt er een concrete actie naar boven, zoals een lege plek vullen, een klant opvolgen of een betaling oppakken. Jij beslist, GlowSuite doet het werk." },
    { q: "Kan ik Mollie koppelen?", a: "Ja. Je koppelt je Mollie-account in een paar klikken en ontvangt direct online betalingen, aanbetalingen en abonnementen." },
    { q: "Kan ik GlowSuite op mijn eigen website plaatsen?", a: "Ja. Onze white-label boekingswidget plaats je met één regel code op elke website, van WordPress tot Squarespace." },
    { q: "Werkt dit ook mobiel?", a: "GlowSuite is volledig mobiel geoptimaliseerd. Jij én je klanten werken vanaf elk apparaat." },
    { q: "Kan ik later upgraden?", a: "Altijd. Je begint klein en breidt features of teamleden uit wanneer je salon groeit." },
  ];

  return (
    <div className="min-h-[100dvh] bg-background text-foreground antialiased selection:bg-primary/20 overflow-x-hidden md:pb-0 pb-24">
      {/* NAV */}
      <header
        className={`sticky top-0 z-50 w-full transition-all ${
          scrolled ? "bg-background/85 backdrop-blur-xl border-b border-border/60" : "bg-transparent"
        }`}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 min-w-0" aria-label="GlowSuite">
            <GlowSuiteLogo size="md" withWordmark priority />
            <span className="hidden sm:inline-flex items-center gap-1.5 pl-2.5 ml-0.5 border-l border-border/60 text-[11px] font-medium text-muted-foreground tracking-wide">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Live salon OS
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-muted-foreground">
            <a href="#ai" className="hover:text-foreground transition-colors">AI</a>
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#prijzen" onClick={scrollToPricing} className="hover:text-foreground transition-colors">Prijzen</a>
            <button type="button" onClick={() => openDemo("nav")} className="hover:text-foreground transition-colors">Demo</button>
            <Link to={LOGIN} className="hover:text-foreground transition-colors">Login</Link>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Button type="button" variant="gradient" size="sm" onClick={() => openDemo("nav-cta")}>
              Bekijk hoe GlowSuite meewerkt
            </Button>
          </div>


          <button
            className="md:hidden p-2 -mr-2 text-foreground"
            aria-label="Menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-border/60 bg-background/95 backdrop-blur-xl">
            <nav className="flex flex-col px-5 py-4 gap-1 text-base">
              <a href="#ai" onClick={() => setMenuOpen(false)} className="py-3 text-foreground/80">AI</a>
              <a href="#features" onClick={() => setMenuOpen(false)} className="py-3 text-foreground/80">Features</a>
              <a
                href="#prijzen"
                onClick={(e) => { setMenuOpen(false); scrollToPricing(e); }}
                className="py-3 text-foreground/80"
              >
                Prijzen
              </a>
              <button
                type="button"
                onClick={() => { setMenuOpen(false); openDemo("mobile-nav"); }}
                className="py-3 text-foreground/80 text-left"
              >
                Demo
              </button>
              <Link to={LOGIN} onClick={() => setMenuOpen(false)} className="py-3 text-foreground/80">Login</Link>
              <Link to={SIGNUP} onClick={() => setMenuOpen(false)} className="w-full mt-2">
                <Button
                  type="button"
                  variant="gradient"
                  className="w-full"
                >
                  Start gratis proefperiode
                </Button>
              </Link>
            </nav>
          </div>
        )}
      </header>

      {/* HERO */}
      <Section className="pt-10 sm:pt-16 pb-12 sm:pb-20 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-70"
          style={{
            background:
              "radial-gradient(60% 50% at 50% 0%, hsl(var(--primary) / 0.14), transparent 70%), radial-gradient(40% 40% at 90% 10%, hsl(var(--accent) / 0.10), transparent 70%)",
          }}
        />
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* LEFT: copy + CTA */}
          <div className="text-center lg:text-left max-w-xl mx-auto lg:mx-0">
            <Eyebrow icon={Sparkles}>Het salon operating system</Eyebrow>
            <h1 className="text-[34px] sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] text-balance">
              Je salonsoftware{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))]">
                zou mee moeten werken.
              </span>
            </h1>
            <p className="mt-5 sm:mt-6 text-base sm:text-xl text-muted-foreground leading-relaxed">
              GlowSuite helpt actief met no-shows voorkomen, lege plekken vullen en klanten opvolgen. Rustig op de achtergrond, zonder losse WhatsAppjes of vergeten opvolging.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center lg:justify-start gap-3 max-w-md sm:max-w-none mx-auto lg:mx-0">
              <Link to={SIGNUP} className="w-full sm:w-auto max-w-full">
                <Button
                  type="button"
                  variant="gradient"
                  size="lg"
                  className="w-full sm:w-auto max-w-full whitespace-normal break-words text-center leading-tight px-5"
                >
                  Start gratis proefperiode <ArrowRight className="w-4 h-4 ml-1 inline shrink-0" />
                </Button>
              </Link>
              <CTADemoRequest onClick={() => openDemo("hero-demo")}>Bekijk hoe GlowSuite meewerkt</CTADemoRequest>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              Ontwikkeld voor salons en klinieken. Binnen enkele minuten actief. Wij helpen met de overstap. Werkt op mobiel, tablet en desktop.
            </p>

          </div>

          {/* RIGHT: hero visual (single premium image) */}
          <div className="w-full">
            <img
              src={heroPhones}
              alt="GlowSuite app op iPhone: dashboard, agenda en klantgroei"
              loading="eager"
              decoding="async"
              draggable={false}
              className="block w-full h-auto max-w-[640px] mx-auto select-none"
              style={{ filter: "drop-shadow(0 30px 50px hsl(var(--primary) / 0.18)) drop-shadow(0 10px 20px rgba(0,0,0,0.08))" }}
            />
          </div>
        </div>

        {/* TRUST STRIP */}
        <div className="mt-14 sm:mt-20 max-w-5xl mx-auto">
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs sm:text-sm text-muted-foreground">
            {trustItems.slice(0, 5).map((t) => {
              const Icon = t.icon;
              return (
                <div key={t.label} className="inline-flex items-center gap-1.5">
                  <Icon className="w-4 h-4 text-primary/70" />
                  <span className="font-medium">{t.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      {/* === GLOWSUITE WERKT ACTIEF MEE === */}
      <Section className="border-t border-border/60">
        <div className="max-w-2xl">
          <Eyebrow icon={Bot}>GlowSuite werkt actief mee</Eyebrow>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight leading-[1.1]">
            Geen software die wacht. Een systeem dat meedoet.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            GlowSuite kijkt de hele dag mee in je agenda, klanten en betalingen. Op het juiste moment komt er een rustige actie naar boven. Jij beslist, GlowSuite doet het werk.
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: Calendar, time: "14:02", tag: "Agenda", t: "Lege plek van 45 minuten gezien", d: "3 vaste klanten geselecteerd. Voorstel om 14:07 verstuurd. Nieuwe afspraak ingepland." },
            { icon: AlertTriangle, time: "09:10", tag: "No-show preventie", t: "Risico gedetecteerd bij afspraak 10:00", d: "Extra herinnering verstuurd om 09:11. Klant bevestigd om 09:22." },
            { icon: Heart, time: "11:24", tag: "Klantopvolging", t: "2 klanten klaar voor een nieuwe afspraak", d: "Persoonlijk voorstel via WhatsApp verstuurd. 1 boeking dezelfde dag." },
            { icon: CreditCard, time: "16:40", tag: "Betalingen", t: "Openstaande betaling gezien", d: "Vriendelijke herinnering verstuurd. Betaling binnen voor sluitingstijd." },
            { icon: UserCheck, time: "08:00", tag: "Vandaag", t: "Dag rustig gestart", d: "Agenda stabiel gevuld. Geen losse acties nodig. GlowSuite blijft meekijken." },
            { icon: Sparkles, time: "12:15", tag: "Omzetkans", t: "3 klanten klaar voor upsell", d: "Voorstel staat klaar om met één tik te versturen, op het juiste moment." },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <Card key={c.t} className="p-5 flex items-start gap-3 hover:border-primary/40 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-primary/80">
                    <span className="tabular-nums text-muted-foreground/80">{c.time}</span>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{c.tag}</span>
                  </div>
                  <div className="mt-1 font-semibold text-sm leading-snug">{c.t}</div>
                  <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{c.d}</p>
                </div>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* === LIVE ACTIVITY FEED — "GlowSuite werkt op de achtergrond" === */}
      <Section className="bg-muted/30 border-y border-border/60">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <div className="max-w-xl">
            <Eyebrow icon={Zap}>Vandaag in jouw salon</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Een stille assistent die op de achtergrond meedraait.
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Geen knoppen indrukken. GlowSuite ziet wat er nodig is en handelt het rustig af. Jij ziet alleen het resultaat.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm">
              {[
                "Vult lege plekken met de juiste vaste klanten",
                "Voorkomt no-shows voordat ze gebeuren",
                "Volgt openstaande betalingen automatisch op",
                "Herinnert klanten op het juiste moment",
              ].map((i) => (
                <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0" />{i}</li>
              ))}
            </ul>
          </div>

          {/* Activity feed mock */}
          <div
            className="relative rounded-3xl border border-border/60 bg-card p-5 sm:p-6"
            style={{ boxShadow: "0 24px 60px -28px hsl(var(--primary) / 0.28)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                </span>
                <span className="text-sm font-semibold">Live activiteit</span>
              </div>
              <span className="text-xs text-muted-foreground">vandaag</span>
            </div>

            <ol className="relative">
              <span aria-hidden className="absolute left-[18px] top-2 bottom-2 w-px bg-border/70" />
              {[
                { time: "09:10", icon: AlertTriangle, tag: "No-show risico", t: "Risico gedetecteerd bij afspraak 10:00" },
                { time: "09:11", icon: Bell, tag: "Actie", t: "Extra herinnering verstuurd via WhatsApp" },
                { time: "09:22", icon: CheckCircle2, tag: "Resultaat", t: "Klant heeft de afspraak bevestigd" },
                { time: "14:02", icon: Calendar, tag: "Lege plek", t: "Gat van 45 minuten gevonden om 14:30" },
                { time: "14:03", icon: Users, tag: "Selectie", t: "3 vaste klanten klaar voor opvolging" },
                { time: "14:07", icon: Heart, tag: "Resultaat", t: "Nieuwe afspraak ingepland" },
              ].map((e, idx) => {
                const Icon = e.icon;
                return (
                  <li
                    key={`${e.time}-${e.t}`}
                    className="relative flex items-start gap-3 py-2.5 animate-fade-in-up"
                    style={{ animationDelay: `${idx * 120}ms`, animationFillMode: "backwards" }}
                  >
                    <div className="relative z-10 w-9 h-9 rounded-full bg-background border border-border/70 text-primary flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="tabular-nums font-medium">{e.time}</span>
                        <span className="text-muted-foreground/60">·</span>
                        <span className="uppercase tracking-wide text-primary/80 font-semibold">{e.tag}</span>
                      </div>
                      <div className="mt-0.5 text-sm font-medium leading-snug">{e.t}</div>
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="mt-4 pt-4 border-t border-border/60 text-xs text-muted-foreground text-center">
              Voorbeeld van een normale werkdag. Signaal, actie, resultaat.
            </div>
          </div>
        </div>
      </Section>

      {/* === DEZE WEEK AUTOMATISCH VOORKOMEN === */}
      <Section className="border-b border-border/60">
        <div className="max-w-2xl">
          <Eyebrow icon={ShieldCheck}>Deze week automatisch opgepakt</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Wat GlowSuite stil voor je regelde.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Een rustig weekoverzicht van wat op de achtergrond is gebeurd. Geen werk voor jou. Geen dashboards om te lezen.
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { v: "4", label: "No-shows voorkomen", d: "Risicoklanten op tijd extra herinnerd." },
            { v: "11", label: "Klanten opgevolgd", d: "Persoonlijke voorstellen op het juiste moment." },
            { v: "6", label: "Lege plekken gevuld", d: "Vrije momenten aangeboden aan vaste klanten." },
            { v: "9", label: "Betalingen afgerond", d: "Vriendelijke herinneringen automatisch verstuurd." },
          ].map((s) => (
            <Card key={s.label} className="p-6">
              <div className="text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))]">
                {s.v}
              </div>
              <div className="mt-2 text-sm font-semibold">{s.label}</div>
              <div className="mt-1 text-xs text-muted-foreground leading-relaxed">{s.d}</div>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          Illustratief weekbeeld op basis van een gemiddelde salon. Eigen cijfers verschijnen zodra je salon live staat.
        </p>
      </Section>

      {/* === WAAROM HET ANDERS VOELT === */}
      <Section>
        <div className="max-w-3xl mx-auto text-center">
          <Eyebrow icon={Heart}>Waarom het anders voelt</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            GlowSuite wacht niet tot jij actie neemt.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Het systeem helpt actief mee met opvolging, lege plekken, no-shows en betalingen. Daardoor voelt je salon rustiger en overzichtelijker, zonder dat je iets extra hoeft te doen.
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-3 gap-4">
          {[
            { icon: Clock, t: "Minder handmatig plannen", d: "Opvolging en herinneringen gaan automatisch, ook als jij druk bent." },
            { icon: ShieldCheck, t: "Minder vergeten opvolging", d: "Geen losse WhatsApp berichten en notities meer. Alles op één plek." },
            { icon: TrendingUp, t: "Minder lege plekken", d: "Vrije momenten worden opgemerkt en aan de juiste klanten voorgesteld." },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <Card key={c.t} className="p-6">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-base">{c.t}</h3>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{c.d}</p>
              </Card>
            );
          })}
        </div>
      </Section>



      <Section id="voor-wie" className="border-t border-border/60">

        <div className="max-w-2xl">
          <Eyebrow icon={AlertTriangle}>Herken je dit?</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Jouw salon verdient software die met je meegroeit.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            De meeste salons verliezen elke week omzet door dingen die slimmer geregeld kunnen worden.
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {problems.map((p) => {
            const Icon = p.icon;
            return (
              <Card key={p.t} className="p-5 flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </div>
                <p className="text-sm sm:text-base font-medium leading-snug">{p.t}</p>
              </Card>
            );
          })}
        </div>
        <div className="mt-10 p-6 rounded-2xl border border-primary/30 bg-primary/5 flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] text-white flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="font-semibold text-lg">GlowSuite lost dit rustig op de achtergrond op.</div>
            <div className="text-muted-foreground text-sm mt-1">
              Een stille assistent die met je salon meewerkt, dag en nacht.
            </div>
          </div>
        </div>
      </Section>

      {/* VALUE / OUTCOMES */}
      <Section className="bg-muted/30 border-y border-border/60">
        <div className="max-w-2xl">
          <Eyebrow>Wat je krijgt</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Eén systeem voor je hele dagelijkse operatie.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Geen losse tools meer. Agenda, betalingen, klantopvolging en inzicht werken samen in één rustige interface.
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {valueCards.map((v) => {
            const Icon = v.icon;
            return (
              <Card key={v.title} className="p-6 hover:border-primary/40 transition-colors group">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-lg">{v.title}</h3>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{v.desc}</p>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* === PRODUCT PROOF — AGENDA === */}
      <Section>
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <div>
            <Eyebrow icon={Calendar}>Agenda</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Een agenda die salons echt begrijpen.
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Plan per medewerker, zie bezetting in één oogopslag en laat AI vrije plekken slim opvullen.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm">
              {["Dagplanning per medewerker", "Realtime bezetting & vrije plekken", "Suggesties voor dalmomenten", "Drag & drop afspraken"].map((i) => (
                <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0" />{i}</li>
              ))}
            </ul>
          </div>
          <MockWindow url="salon.glowsuite.nl/agenda">
            <Shot src={shotAgenda} alt="GlowSuite agenda met dagplanning per medewerker" />
          </MockWindow>
        </div>
      </Section>

      {/* === PRODUCT PROOF — BETALINGEN === */}
      <Section className="bg-muted/30 border-y border-border/60">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <MockWindow url="salon.glowsuite.nl/betalingen">
            <Shot src={shotBetalingen} alt="GlowPay betalingen overzicht met live betaalstatussen" />
          </MockWindow>
          <div>
            <Eyebrow icon={CreditCard}>Betalingen</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Ontvang aanbetalingen en betalingen via Mollie.
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Veilige online betalingen, automatische bevestigingen en refunds in één klik. Meer zekerheid vooraf.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm">
              {["Mollie verbonden in 2 minuten", "iDEAL, Wero, Bancontact, kaart", "Live betaalstatussen", "Refunds direct vanuit GlowSuite"].map((i) => (
                <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0" />{i}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* === AI FEATURE SECTION === */}
      <Section id="ai" className="relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-60"
          style={{
            background:
              "radial-gradient(50% 40% at 20% 20%, hsl(var(--primary) / 0.10), transparent 70%), radial-gradient(50% 40% at 80% 80%, hsl(var(--accent) / 0.08), transparent 70%)",
          }}
        />
        <div className="max-w-2xl">
          <Eyebrow icon={Brain}>AI binnen GlowSuite</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Slimme acties die concrete omzet opleveren.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Geen gimmicks. GlowSuite werkt op de achtergrond mee en geeft je rust, overzicht en groei.
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {aiBlocks.map((b) => {
            const Icon = b.icon;
            return (
              <Card key={b.t} className="p-6 border-primary/20">
                <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] text-white flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-lg leading-tight">{b.t}</h3>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed">{b.d}</p>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* === MIGRATION TRUST === */}
      <Section className="border-y border-border/60">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <div>
            <Eyebrow icon={MoveRight}>Overstappen</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Stap eenvoudig over van je oude systeem.
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Zet klanten, afspraken en gegevens met één klik over naar GlowSuite. Geen gedoe. Geen verlies van data.
            </p>
            <ul className="mt-6 grid sm:grid-cols-2 gap-2.5 text-sm">
              {[
                "Snelle overstap",
                "Begeleiding mogelijk",
                "Veilig overzetten",
                "Geen technische kennis nodig",
                "Direct verder werken",
                "Hulp bij eerste week",
              ].map((i) => (
                <li key={i} className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                  {i}
                </li>
              ))}
            </ul>
            <div className="mt-7">
              <CTADemoRequest onClick={() => openMigration("migration-help")} variant="gradient">
                Vraag hulp bij overstappen
              </CTADemoRequest>
            </div>
          </div>
          <div className="relative">
            <div className="rounded-3xl border border-border/60 bg-card p-6 sm:p-8 shadow-[0_24px_60px_-30px_hsl(var(--primary)/0.3)]">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-semibold">Begeleide overstap</div>
                  <div className="text-xs text-muted-foreground">Wij regelen het samen met je mee</div>
                </div>
              </div>
              <div className="space-y-3">
                {[
                  { t: "Klanten importeren", d: "Vanuit je huidige systeem of uit een Excel." },
                  { t: "Afspraken overzetten", d: "Bestaande boekingen blijven gewoon staan." },
                  { t: "Online boeken activeren", d: "Je boekingspagina staat dezelfde dag live." },
                ].map((s, idx) => (
                  <div
                    key={s.t}
                    className="flex items-start gap-3 p-3 rounded-xl bg-muted/40 border border-border/50"
                  >
                    <div className="w-7 h-7 rounded-lg bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </div>
                    <div>
                      <div className="text-sm font-semibold">{s.t}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">{s.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* === RESULT SECTION === */}
      <Section className="bg-muted/30 border-y border-border/60">
        <div className="max-w-2xl">
          <Eyebrow icon={TrendingUp}>Wat het oplevert</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Concrete resultaten voor je salon.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Geen vage beloftes. Dit merken salons binnen de eerste maanden.
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: Calendar, t: "Meer boekingen", d: "Klanten boeken zelf, ook 's avonds en in het weekend." },
            { icon: Bell, t: "Minder no-shows", d: "Automatische herinneringen via WhatsApp en e-mail." },
            { icon: Heart, t: "Meer herhaalklanten", d: "Vaste klanten krijgen op tijd een persoonlijk voorstel." },
            { icon: Clock, t: "Minder handmatig werk", d: "Geen losse appjes, mailtjes of notities meer." },
            { icon: TrendingUp, t: "Minder lege plekken", d: "Dalmomenten worden actief opgevuld." },
            { icon: Coins, t: "Terugkerende inkomsten", d: "Bouw vaste maandomzet op met abonnementen." },
          ].map((r) => {
            const Icon = r.icon;
            return (
              <Card key={r.t} className="p-6">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-lg">{r.t}</h3>
                <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{r.d}</p>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* === PRODUCT PROOF — ABONNEMENTEN === */}
      <Section className="bg-muted/30 border-y border-border/60">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <div>
            <Eyebrow icon={Repeat}>Abonnementen</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Bouw terugkerende omzet met abonnementen.
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Verkoop maandpakketten met credits en houd MRR, leden en churn realtime in beeld.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm">
              {["Eigen aanmeldpagina per salon", "Credits per behandeling", "MRR & churn dashboard", "Automatische incasso via Mollie"].map((i) => (
                <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0" />{i}</li>
              ))}
            </ul>
          </div>
          <MockWindow url="salon.glowsuite.nl/abonnementen">
            <div className="p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Memberships</div>
                  <div className="mt-1 text-lg font-semibold">Deze maand</div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Live
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "MRR", value: "€ 2.450", sub: "+12% vs vorige maand" },
                  { label: "Actieve leden", value: "47", sub: "+5 deze maand" },
                  { label: "Churn", value: "1,8%", sub: "Stabiel" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{s.label}</div>
                    <div className="mt-1 text-xl font-bold tabular-nums">{s.value}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{s.sub}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border/60 bg-background/70 divide-y divide-border/50">
                {[
                  { name: "Glow Essentials", price: "€ 39", members: 22, color: "from-primary to-accent" },
                  { name: "Glow Plus", price: "€ 69", members: 18, color: "from-accent to-primary" },
                  { name: "Glow VIP", price: "€ 129", members: 7, color: "from-primary to-accent" },
                ].map((p) => (
                  <div key={p.name} className="flex items-center justify-between px-4 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${p.color} text-white flex items-center justify-center text-[11px] font-bold`}>
                        {p.name.split(" ")[1]?.[0] ?? "G"}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate">{p.name}</div>
                        <div className="text-[11px] text-muted-foreground">{p.members} actieve leden</div>
                      </div>
                    </div>
                    <div className="text-sm font-semibold tabular-nums">{p.price}<span className="text-[11px] text-muted-foreground font-normal">/mnd</span></div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Automatische incasso via Mollie</span>
                <span>Bijgewerkt zojuist</span>
              </div>
            </div>
          </MockWindow>
        </div>
      </Section>

      {/* === PRODUCT PROOF — RAPPORTAGE === */}
      <Section id="features">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <MockWindow url="salon.glowsuite.nl/rapporten">
            <Shot src={shotRapportage} alt="Rapportage met omzetcijfers, maanddoel en klantenwaarde" />
          </MockWindow>
          <div>
            <Eyebrow icon={LineChart}>Rapportage & inzicht</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Eerlijke cijfers. Slimme beslissingen.
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              GlowSuite vertaalt je dagelijkse data naar concrete acties: wie opvolgen, welke plek vullen, welke betaling oppikken. Geen dashboards lezen.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm">
              {["Omzettrend per periode", "Top behandelingen & medewerkers", "Klantenwaarde (LTV)", "Slimme inzichten & exports"].map((i) => (
                <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0" />{i}</li>
              ))}
            </ul>
          </div>
        </div>
      </Section>

      {/* HOW IT WORKS */}
      <Section className="bg-muted/30 border-y border-border/60">
        <div className="max-w-2xl">
          <Eyebrow>Zo werkt het</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">In 3 stappen rustiger werken.</h2>
        </div>
        <div className="mt-10 grid md:grid-cols-3 gap-5">
          {[
            { n: "01", t: "Verbind je salon", d: "Voeg je behandelingen, tijden en team toe. Klaar in een paar minuten." },
            { n: "02", t: "GlowSuite automatiseert", d: "Afspraken, betalingen en opvolging draaien op de achtergrond mee." },
            { n: "03", t: "Meer rust en meer omzet", d: "Jij houdt tijd over en ziet je salon stabiel groeien." },
          ].map((s) => (
            <div key={s.n} className="relative p-6 rounded-2xl border border-border/60 bg-card">
              <div className="text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-primary/30 to-accent/20">
                {s.n}
              </div>
              <h3 className="mt-3 font-semibold text-lg">{s.t}</h3>
              <p className="text-sm text-muted-foreground mt-1">{s.d}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* WHATSAPP AUTOMATISERING */}
      <Section id="whatsapp-automatisering" className="bg-gradient-to-b from-background via-primary/[0.03] to-background">
        <div className="max-w-3xl mx-auto text-center">
          <Eyebrow icon={MessageCircle}>WhatsApp Automatisering voor salons</Eyebrow>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
            Nooit meer no-shows met automatische WhatsApp reminders.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg leading-relaxed">
            GlowSuite stuurt automatisch afspraakbevestigingen, reminders en no-show opvolging via WhatsApp.
          </p>
        </div>

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            {
              icon: CheckCircle2,
              tag: "Direct na boeking",
              title: "Bevestiging",
              desc: "Klant krijgt meteen een persoonlijke WhatsApp-bevestiging met datum, tijd en locatie.",
            },
            {
              icon: Bell,
              tag: "24 uur vooraf",
              title: "Reminder",
              desc: "Automatische herinnering een dag voor de afspraak. Merkbaar minder no-shows.",
            },
            {
              icon: Repeat,
              tag: "Gemiste afspraak",
              title: "Automatische follow-up",
              desc: "Klant niet verschenen? GlowSuite stuurt direct een vriendelijk bericht om opnieuw te boeken.",
            },
          ].map((c) => (
            <Card
              key={c.title}
              className="p-6 sm:p-7 flex flex-col gap-4 relative overflow-hidden hover:border-primary/40 transition-all duration-300"
              style={{ boxShadow: "0 12px 40px -20px hsl(var(--primary) / 0.18)" }}
            >
              <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full bg-gradient-to-br from-primary/15 to-accent/10 blur-2xl pointer-events-none" />
              <div className="relative w-12 h-12 rounded-xl bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] flex items-center justify-center text-white shadow-lg">
                <c.icon className="w-6 h-6" />
              </div>
              <div className="relative">
                <div className="text-xs font-semibold uppercase tracking-wide text-primary/80">{c.tag}</div>
                <h3 className="mt-1 text-xl font-semibold tracking-tight">{c.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{c.desc}</p>
              </div>
            </Card>
          ))}
        </div>

        <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link to={SIGNUP} className="w-full sm:w-auto">
            <Button
              size="lg"
              className="w-full sm:w-auto h-12 px-8 text-base font-semibold bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))] hover:opacity-95 text-white border-0"
              style={{ boxShadow: "0 16px 40px -12px hsl(var(--primary) / 0.45)" }}
            >
              Start gratis proefperiode
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
          <p className="text-xs text-muted-foreground">14 dagen gratis · geen creditcard nodig</p>
        </div>
      </Section>

      {/* ROI CALCULATOR */}
      <RoiCalculator />

      {/* TESTIMONIALS */}
      <TestimonialsSection />

      {/* PRICING */}
      <Section id="prijzen">
        <div className="max-w-3xl mx-auto text-center">
          <Eyebrow>Prijzen</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Een operationeel systeem dat zichzelf terugverdient.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Vanaf <span className="font-semibold text-foreground">€39 / maand</span>. Eén voorkomen no-show per week dekt het abonnement al. Maandelijks opzegbaar, zonder verborgen kosten.
          </p>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-5 items-stretch">
          {plans.map((p) => (
            <Card
              key={p.name}
              className={`p-6 sm:p-7 flex flex-col relative ${
                p.featured ? "border-primary/60 ring-1 ring-primary/30 md:scale-[1.02]" : ""
              }`}
              style={p.featured ? { boxShadow: "0 24px 60px -24px hsl(var(--primary) / 0.35)" } : undefined}
            >
              {p.featured && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))] text-white text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap">
                  Meest gekozen
                </div>
              )}
              <div className="font-semibold text-lg">{p.name}</div>
              <div className="text-xs text-muted-foreground">{p.tagline}</div>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{p.price}</span>
                <span className="text-muted-foreground">/maand</span>
              </div>
              <ul className="mt-5 space-y-2.5 text-sm flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-col gap-2">
                <Button
                  type="button"
                  variant={p.featured ? "gradient" : "default"}
                  className="w-full whitespace-normal"
                  onClick={() => {
                    if (p.requiresDemo) {
                      openDemo(`pricing-${p.slug}-trial`);
                    } else {
                      window.location.href = `/login?mode=signup&plan=${p.slug}`;
                    }
                  }}
                >
                  {p.requiresDemo ? "Vraag demo aan" : "Start 14 dagen gratis"}
                </Button>
                {!p.requiresDemo && (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full whitespace-normal"
                      onClick={() => openCheckout(p.slug, p.name, p.price)}
                    >
                      Nu live starten
                    </Button>
                    <p className="text-[11px] text-muted-foreground text-center leading-snug">
                      Veilig betalen via Mollie. Maandelijks opzegbaar.
                    </p>
                  </>
                )}
                <Link
                  to="/pricing"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors text-center mt-1"
                >
                  Bekijk alle details →
                </Link>
              </div>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Prijzen excl. btw. Maandelijks opzegbaar. Geen setup-kosten.
        </p>
      </Section>

      {/* TRUST */}
      <Section className="bg-muted/30 border-y border-border/60">
        <div className="max-w-2xl">
          <Eyebrow icon={Shield}>Waarom GlowSuite</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Ontwikkeld voor salons en klinieken die rust en grip willen.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Veilige betalingen, eigen klantdata en dagelijks inzicht in afspraken, betalingen en opvolging. Zonder gedoe.
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {trustItems.map((t) => {
            const Icon = t.icon;
            return (
              <div key={t.label} className="flex items-start gap-3 p-5 rounded-2xl bg-card border border-border/60">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-semibold">{t.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* OPERATIONAL IMPACT (structured, no fake quotes) */}
      <Section>
        <div className="max-w-2xl">
          <Eyebrow icon={TrendingUp}>Wat salons merken</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Van losse handelingen naar een rustige werkdag.</h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Een indicatief beeld van wat er verandert zodra GlowSuite op de achtergrond meedraait. Geen marketingclaims, gewoon wat de software wegneemt.
          </p>
        </div>
        {/* Early-stage trust block (no fake names or quotes) */}
        <div className="mt-8 rounded-2xl border border-border/60 bg-muted/20 px-6 py-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs sm:text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2 font-medium text-foreground/80">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            Binnenkort live met de eerste salons en klinieken
          </span>
          <span className="hidden sm:inline text-muted-foreground/40">·</span>
          <span>Pilotplekken beschikbaar</span>
          <span className="hidden sm:inline text-muted-foreground/40">·</span>
          <span>Gebouwd samen met salonhouders</span>
        </div>

        {/* 3 trust cards */}
        <div className="mt-6 grid sm:grid-cols-3 gap-4">
          {[
            { label: "Minder losse handelingen", icon: Wand2, d: "Bevestigingen, herinneringen en opvolging lopen vanzelf mee." },
            { label: "Minder vergeten opvolging", icon: Bell, d: "Klanten en betalingen blijven niet liggen, ook op drukke dagen." },
            { label: "Meer rust in de werkdag", icon: Heart, d: "Eén overzicht met alleen wat aandacht vraagt. Geen ruis." },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <Card key={c.label} className="p-5">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="font-semibold">{c.label}</div>
                <div className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{c.d}</div>
              </Card>
            );
          })}
        </div>

        <div className="mt-10 grid md:grid-cols-3 gap-4">
          {[
            { label: "No-show preventie", before: "Losse appjes en gemiste herinneringen", after: "Automatische bevestiging en reminder per klant" },
            { label: "Lege plekken", before: "Gaten blijven open tot het einde van de dag", after: "Vrije momenten worden actief aangeboden aan vaste klanten" },
            { label: "Klantopvolging", before: "Onthouden wie weer toe is aan een afspraak", after: "Persoonlijk voorstel op het juiste moment, klaar om te versturen" },
            { label: "Betalingen", before: "Handmatig nabellen voor openstaande bedragen", after: "Vriendelijke herinneringen gaan automatisch uit" },
            { label: "Overzicht", before: "Notities, screenshots en losse tools", after: "Eén dagoverzicht met alleen wat aandacht vraagt" },
            { label: "Werkdruk", before: "Continu schakelen tussen taken", after: "Rustigere dagen met minder ad-hoc beslissingen" },
          ].map((r) => (
            <Card key={r.label} className="p-6">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-primary/80">{r.label}</div>
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70 px-2 py-0.5 rounded-full bg-muted/60">Indicatief voorbeeld</span>
              </div>
              <div className="mt-3 text-sm text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground/70">Vandaag:</span> {r.before}
              </div>
              <div className="mt-2 text-sm leading-relaxed">
                <span className="font-medium text-primary">Met GlowSuite:</span> {r.after}
              </div>
            </Card>
          ))}
        </div>

        {/* Ervaringen uit pilots */}
        <div className="mt-10">
          <h3 className="text-lg font-semibold tracking-tight mb-4">Ervaringen uit pilots</h3>
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { label: "Salon uit Rotterdam", focus: "Rust", quote: "Het voelt rustiger omdat opvolging automatisch doorloopt. Ik hoef niet meer zelf bij te houden wie wanneer een herinnering nodig heeft." },
              { label: "Kliniek uit Amsterdam", focus: "Minder handwerk", quote: "Het scheelt veel handmatig appen en herinneringen sturen. De tijd die ik overhoud besteed ik aan klanten in plaats aan administratie." },
              { label: "Team uit Utrecht", focus: "Overzicht", quote: "Je ziet sneller waar nog omzet of opvolging ligt. Voorheen merkte je dat pas aan het einde van de week." },
            ].map((p) => (
              <Card key={p.label} className="p-5 flex flex-col">
                <span className="inline-flex self-start px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-semibold uppercase tracking-wide mb-3">
                  {p.focus}
                </span>
                <p className="text-sm leading-relaxed text-foreground/90 flex-1">
                  "{p.quote}"
                </p>
                <div className="mt-4 pt-3 border-t border-border/50">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    {p.label}
                  </span>
                </div>
              </Card>
            ))}
          </div>
        </div>

        <p className="mt-6 text-xs text-muted-foreground text-center">
          Indicatief overzicht. Echte klantresultaten en namen volgen zodra eerste partners live zijn.
        </p>
      </Section>

      {/* FAQ */}
      <Section className="bg-muted/30 border-y border-border/60">
        <div className="max-w-2xl mx-auto">
          <div className="text-center">
            <Eyebrow>Veelgestelde vragen</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Alles wat je wilt weten.</h2>
          </div>
          <Accordion type="single" collapsible className="mt-8 rounded-2xl border border-border/60 bg-card px-5">
            {faqs.map((f, i) => (
              <AccordionItem key={i} value={`item-${i}`} className="border-border/60 last:border-b-0">
                <AccordionTrigger className="text-left font-semibold">{f.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground leading-relaxed">{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Section>

      {/* FINAL CTA */}
      <Section className="text-center relative overflow-hidden">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 opacity-70"
          style={{
            background:
              "radial-gradient(60% 60% at 50% 50%, hsl(var(--primary) / 0.14), transparent 70%), radial-gradient(40% 40% at 20% 80%, hsl(var(--accent) / 0.10), transparent 70%)",
          }}
        />
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
            Klaar voor minder chaos en{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))]">
              meer rust in je salon?
            </span>
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">
            Ontdek hoe GlowSuite je dag rustiger en winstgevender maakt. Wij helpen je met de overstap.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 max-w-md sm:max-w-none mx-auto">
            <Link to={SIGNUP} className="w-full sm:w-auto max-w-full">
              <Button
                type="button"
                variant="gradient"
                size="lg"
                className="w-full sm:w-auto max-w-full whitespace-normal break-words text-center leading-tight px-5"
              >
                Start gratis proefperiode <ArrowRight className="w-4 h-4 ml-1 inline shrink-0" />
              </Button>
            </Link>
            <CTADemoRequest onClick={() => openDemo("final-cta-demo")}>Bekijk het dashboard</CTADemoRequest>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            Binnen enkele minuten actief. Geen creditcard nodig. Maandelijks opzegbaar.
          </p>
        </div>
      </Section>

      {/* FOOTER */}
      <footer className="border-t border-border/60 px-5 sm:px-8 py-10 pb-28 md:pb-10">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <GlowSuiteLogo size="sm" />
            <span className="text-sm text-muted-foreground">© {new Date().getFullYear()} GlowSuite</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#ai" className="hover:text-foreground">AI</a>
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#prijzen" onClick={scrollToPricing} className="hover:text-foreground">Prijzen</a>
            <Link to={LOGIN} className="hover:text-foreground">Login</Link>
          </div>
        </div>
      </footer>

      {/* STICKY MOBILE CTA */}
      <div
        className={`md:hidden fixed inset-x-0 bottom-0 z-40 transition-transform duration-300 ${
          showStickyCta ? "translate-y-0" : "translate-y-full"
        }`}
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
      >
        <div className="mx-3 mb-2 rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl p-2.5 shadow-2xl flex gap-2">
          <Link to={SIGNUP} className="flex-1">
            <Button
              type="button"
              variant="gradient"
              className="w-full whitespace-normal"
            >
              Start gratis
            </Button>
          </Link>
          <Button
            type="button"
            variant="outline"
            className="flex-1 whitespace-normal"
            onClick={() => openDemo("sticky-mobile-demo")}
          >
            Demo
          </Button>
        </div>
      </div>

      <DemoRequestDialog open={demoOpen} onOpenChange={setDemoOpen} source={demoSource} />
      <MigrationHelpDialog open={migrationOpen} onOpenChange={setMigrationOpen} source={migrationSource} />
      <DirectCheckoutDialog
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        planSlug={checkoutPlan?.slug ?? null}
        planName={checkoutPlan?.name}
        planPrice={checkoutPlan?.price}
      />
    </div>
  );
}
