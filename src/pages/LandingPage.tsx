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
import logoFull from "@/assets/logo-full.png";
import logoIcon from "@/assets/logo-icon.png";
import { DemoRequestDialog } from "@/components/DemoRequestDialog";
import { TestimonialsSection } from "@/components/TestimonialsSection";
import { useTrackOnMount } from "@/hooks/useAnalytics";
import { DirectCheckoutDialog } from "@/components/DirectCheckoutDialog";
import shotDashboard from "@/assets/landing/dashboard.png";
import shotAgenda from "@/assets/landing/agenda.png";
import shotBetalingen from "@/assets/landing/betalingen.png";
import shotAbonnementen from "@/assets/landing/abonnementen.png";
import shotRapportage from "@/assets/landing/rapportage.png";
import heroPhones from "@/assets/glowsuite-hero-phones.png";

const SIGNUP = "/login?mode=signup";
const LOGIN = "/login";

function Section({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`w-full px-5 sm:px-8 py-12 sm:py-20 lg:py-24 ${className}`}>
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
    { icon: Calendar, title: "24/7 online boekingen", desc: "Klanten boeken terwijl jij aan het werk — of slaapt." },
    { icon: Bot, title: "Slimme AI herinneringen", desc: "Minder no-shows, zonder dat jij iets hoeft te doen." },
    { icon: CreditCard, title: "Betalingen & aanbetalingen", desc: "Meer zekerheid vooraf via Mollie." },
    { icon: Repeat, title: "Abonnementen", desc: "Terugkerende omzet, iedere maand opnieuw." },
    { icon: TrendingUp, title: "AI klantgroei tools", desc: "Meer herhaalboekingen en slimme upsells." },
    { icon: LineChart, title: "Realtime inzicht", desc: "Zie direct waar geld blijft liggen in je salon." },
  ];

  const aiBlocks = [
    { icon: Wand2, t: "Vult lege momenten slimmer op", d: "AI herkent dalmomenten en stelt acties voor om ze te vullen." },
    { icon: Users, t: "Herkent klanten die bijna terug moeten komen", d: "Automatische winback-suggesties op het juiste moment." },
    { icon: Target, t: "Geeft omzetkansen aan", d: "Slimme upsells, herboekingen en doelgerichte campagnes." },
    { icon: Zap, t: "Bespaart tijd met automatisering", d: "Reminders, bevestigingen, opvolging — allemaal automatisch." },
    { icon: Brain, t: "Laat je slimmer werken", d: "AI inzichten die jou helpen betere keuzes te maken." },
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
        "AI omzet-inzichten",
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
        "AI Auto Revenue Engine",
        "Persoonlijke onboarding",
      ],
    },
  ];

  const faqs = [
    { q: "Is GlowSuite geschikt voor kleine salons?", a: "Ja. GlowSuite werkt voor solo-professionals én teams. Je betaalt alleen voor wat je nodig hebt en je kunt op elk moment opschalen." },
    { q: "Hoe werkt de AI van GlowSuite precies?", a: "Onze AI kijkt mee in je agenda, klantgedrag en omzetdata. Zo krijg je suggesties voor lege plekken, herhaalboekingen, upsells en marketing — zonder dat jij dashboards hoeft te lezen." },
    { q: "Kan ik Mollie koppelen?", a: "Ja. Je koppelt je Mollie-account in een paar klikken en ontvangt direct online betalingen, aanbetalingen en abonnementen." },
    { q: "Kan ik GlowSuite op mijn eigen website plaatsen?", a: "Ja. Onze white-label boekingswidget plaats je met één regel code op elke website — van WordPress tot Squarespace." },
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
          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img src={logoIcon} alt="GlowSuite" className="w-8 h-8 rounded-lg shrink-0" />
            <img src={logoFull} alt="GlowSuite" className="h-5 w-auto hidden sm:block" />
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
              Start gratis proefperiode
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
              <Button
                type="button"
                variant="gradient"
                className="w-full mt-2"
                onClick={() => { setMenuOpen(false); openDemo("mobile-cta"); }}
              >
                Start gratis proefperiode
              </Button>
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
            <Eyebrow icon={Brain}>Slim salonplatform met AI</Eyebrow>
            <h1 className="text-[34px] sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] text-balance">
              Laat je salon groeien op{" "}
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))]">
                automatische piloot.
              </span>
            </h1>
            <p className="mt-5 sm:mt-6 text-base sm:text-xl text-muted-foreground leading-relaxed">
              GlowSuite automatiseert boekingen, betalingen, klantopvolging en slimme AI taken. Zo verdien je meer en houd je meer tijd over.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center lg:justify-start gap-3 max-w-md sm:max-w-none mx-auto lg:mx-0">
              <CTADemoRequest onClick={() => openDemo("hero-start")} variant="gradient">
                Start gratis proefperiode <ArrowRight className="w-4 h-4 ml-1 inline shrink-0" />
              </CTADemoRequest>
              <CTADemoRequest onClick={() => openDemo("hero-demo")}>Vraag demo aan</CTADemoRequest>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              Binnen enkele minuten live • Geen technische kennis nodig • Gemaakt voor salons
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
            <div className="font-semibold text-lg">GlowSuite lost dit automatisch op.</div>
            <div className="text-muted-foreground text-sm mt-1">
              Slimme AI-tools die met je salon meewerken — dag en nacht.
            </div>
          </div>
        </div>
      </Section>

      {/* VALUE / OUTCOMES */}
      <Section className="bg-muted/30 border-y border-border/60">
        <div className="max-w-2xl">
          <Eyebrow>Wat je krijgt</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Eén platform. Zes manieren om meer omzet te draaien.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Geen losse tools meer. GlowSuite combineert agenda, betalingen en AI in één premium systeem.
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
              {["Dagplanning per medewerker", "Realtime bezetting & vrije plekken", "AI suggereert dalmoment-acties", "Drag & drop afspraken"].map((i) => (
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
            AI die geld voor je terugverdient.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Geen gimmicks. Slimme AI-tools die met je salon meewerken en concrete omzet opleveren.
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
              <CTADemoRequest onClick={() => openDemo("migration-help")} variant="gradient">
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
            { icon: Bell, t: "Minder no-shows", d: "Slimme herinneringen via WhatsApp en e-mail." },
            { icon: Heart, t: "Meer herhaalklanten", d: "Automatische opvolging op het juiste moment." },
            { icon: Clock, t: "Meer rust in je planning", d: "Geen losse appjes en mailtjes meer." },
            { icon: TrendingUp, t: "Meer omzetkansen", d: "AI laat zien waar geld blijft liggen." },
            { icon: Coins, t: "Terugkerende inkomsten", d: "Bouw vaste maandinkomsten op met abonnementen." },
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
            <Shot src={shotAbonnementen} alt="Abonnementen dashboard met MRR, leden en churn" />
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
              AI vertaalt je data naar concrete omzetkansen — zonder dat jij dashboards hoeft te lezen.
            </p>
            <ul className="mt-6 space-y-2.5 text-sm">
              {["Omzettrend per periode", "Top behandelingen & medewerkers", "Klantenwaarde (LTV)", "AI inzichten & exports"].map((i) => (
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
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">In 3 stappen live.</h2>
        </div>
        <div className="mt-10 grid md:grid-cols-3 gap-5">
          {[
            { n: "01", t: "Stel je salon in", d: "Voeg behandelingen, tijden en medewerkers toe — binnen minuten." },
            { n: "02", t: "Zet online boeken live", d: "Plaats de white-label widget op je website of deel je boekingslink." },
            { n: "03", t: "Laat de AI meewerken", d: "Bevestigingen, betalingen en groei-suggesties draaien automatisch." },
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

      {/* TESTIMONIALS */}
      <TestimonialsSection />

      {/* PRICING */}
      <Section id="prijzen">
        <div className="max-w-3xl mx-auto text-center">
          <Eyebrow>Prijzen</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Betaalbaar voor kleine salons. Krachtig genoeg voor groei.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Vanaf <span className="font-semibold text-foreground">€39 / maand</span>. Groei wanneer jij groeit. Geen verborgen kosten.
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
            Gebouwd op vertrouwen, ontworpen voor groei.
          </h2>
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

      {/* TESTIMONIALS */}
      <Section>
        <div className="max-w-2xl">
          <Eyebrow icon={Star}>Wat salons zeggen</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Salons die kiezen voor rust en groei.</h2>
        </div>
        <div className="mt-10 grid md:grid-cols-3 gap-4">
          {[
            { q: "Eindelijk één systeem voor boekingen, betalingen en klanten.", a: "Salon eigenaar" },
            { q: "De AI-suggesties leveren mij elke week extra boekingen op.", a: "Beauty studio" },
            { q: "GlowSuite voelt veel moderner dan wat we hiervoor gebruikten.", a: "Barbershop" },
          ].map((t) => (
            <Card key={t.a} className="p-6">
              <div className="flex gap-0.5 text-primary">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star key={i} className="w-4 h-4 fill-current" />
                ))}
              </div>
              <p className="mt-3 text-base leading-relaxed">"{t.q}"</p>
              <p className="mt-4 text-sm text-muted-foreground">— {t.a}</p>
            </Card>
          ))}
        </div>
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
            Klaar voor meer groei en{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))]">
              minder gedoe?
            </span>
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">
            Werk slimmer met GlowSuite. Meer rust, meer boekingen en meer omzet in je salon.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 max-w-md sm:max-w-none mx-auto">
            <CTADemoRequest onClick={() => openDemo("final-cta-start")} variant="gradient">
              Start gratis proefperiode <ArrowRight className="w-4 h-4 ml-1 inline shrink-0" />
            </CTADemoRequest>
            <CTADemoRequest onClick={() => openDemo("final-cta-demo")}>Vraag demo aan</CTADemoRequest>
          </div>
          <p className="mt-5 text-xs text-muted-foreground">
            Binnen enkele minuten live • Geen creditcard nodig • Maandelijks opzegbaar
          </p>
        </div>
      </Section>

      {/* FOOTER */}
      <footer className="border-t border-border/60 px-5 sm:px-8 py-10 pb-28 md:pb-10">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src={logoIcon} alt="GlowSuite" className="w-7 h-7 rounded-lg" />
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
          <Button
            type="button"
            variant="gradient"
            className="flex-1 whitespace-normal"
            onClick={() => openDemo("sticky-mobile-start")}
          >
            Start gratis
          </Button>
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
