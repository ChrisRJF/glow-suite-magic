import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Calendar, CreditCard, Repeat, Users, Sparkles, BarChart3,
  Zap, ShoppingBag, RefreshCcw, LayoutGrid, Globe, Shield,
  CheckCircle2, ArrowRight, Menu, X, Star, Clock, TrendingUp,
} from "lucide-react";
import logoFull from "@/assets/logo-full.png";
import logoIcon from "@/assets/logo-icon.png";

const SIGNUP = "/login?mode=signup";
const DEMO = "/login?demo=1";
const LOGIN = "/login";

function Section({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`w-full px-5 sm:px-8 py-16 sm:py-24 ${className}`}>
      <div className="max-w-6xl mx-auto">{children}</div>
    </section>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide uppercase mb-4">
      <Sparkles className="w-3.5 h-3.5" />
      {children}
    </div>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Force light mode on landing page
  useEffect(() => {
    document.documentElement.classList.add("light");
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const features = [
    { icon: Calendar, title: "Online agenda", desc: "Realtime overzicht van al je afspraken." },
    { icon: Globe, title: "White-label widget", desc: "Online boekingen op je eigen website." },
    { icon: CreditCard, title: "Mollie betalingen", desc: "iDEAL, Bancontact, Apple Pay en meer." },
    { icon: Repeat, title: "Abonnementen", desc: "Terugkerende omzet op autopiloot." },
    { icon: Users, title: "Klantenbeheer", desc: "Profielen, geschiedenis en voorkeuren." },
    { icon: Zap, title: "Automatiseringen", desc: "Reminders, herboekingen en winbacks." },
    { icon: BarChart3, title: "Rapportages", desc: "Slimme inzichten in omzet en team." },
    { icon: Shield, title: "Team & rollen", desc: "Veilige toegang per medewerker." },
    { icon: ShoppingBag, title: "Productshop widget", desc: "Verkoop producten online en in salon." },
    { icon: RefreshCcw, title: "Refunds & beheer", desc: "Terugbetalingen in één klik." },
  ];

  const problems = [
    "Gaten in je agenda kosten omzet",
    "Klanten vergeten afspraken",
    "Betalingen en aanbetalingen zijn omslachtig",
    "Herhaalboekingen worden vergeten",
    "Alles zit verspreid over losse tools",
  ];

  const benefits = [
    "Online boeken op je eigen website",
    "Aanbetalingen via Mollie",
    "Automatische afspraakbevestigingen",
    "Abonnementen voor terugkerende omzet",
    "Slimme rapportages en omzetinzichten",
    "Minder handwerk voor jou en je team",
  ];

  const faqs = [
    { q: "Is GlowSuite geschikt voor kleine salons?", a: "Ja. GlowSuite werkt voor solo-professionals én teams. Je betaalt alleen voor wat je nodig hebt en je kunt op elk moment opschalen." },
    { q: "Kan ik Mollie koppelen?", a: "Ja. Je koppelt je Mollie-account in een paar klikken en ontvangt direct online betalingen, aanbetalingen en abonnementen." },
    { q: "Kan ik GlowSuite op mijn eigen website plaatsen?", a: "Ja. Onze white-label boekingswidget plaats je met één regel code op elke website — van WordPress tot Squarespace." },
    { q: "Werkt dit ook mobiel?", a: "GlowSuite is volledig mobiel geoptimaliseerd. Jij én je klanten werken vanaf elk apparaat." },
    { q: "Kan mijn team meekijken?", a: "Ja. Je voegt teamleden toe met eigen rollen en rechten — van eigenaar tot medewerker." },
    { q: "Kan ik later upgraden?", a: "Altijd. Je begint klein en breidt features of teamleden uit wanneer je salon groeit." },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground antialiased selection:bg-primary/20">
      {/* NAV */}
      <header
        className={`sticky top-0 z-50 w-full transition-all ${
          scrolled ? "bg-background/85 backdrop-blur-xl border-b border-border/60" : "bg-transparent"
        }`}
      >
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <img src={logoIcon} alt="GlowSuite" className="w-8 h-8 rounded-lg" />
            <img src={logoFull} alt="GlowSuite" className="h-5 w-auto hidden sm:block" />
          </Link>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#voor-wie" className="hover:text-foreground transition-colors">Voor wie</a>
            <a href="#prijzen" className="hover:text-foreground transition-colors">Prijzen</a>
            <a href={DEMO} className="hover:text-foreground transition-colors">Demo</a>
            <Link to={LOGIN} className="hover:text-foreground transition-colors">Login</Link>
          </nav>

          <div className="hidden md:flex items-center gap-3">
            <Link to={SIGNUP}>
              <Button variant="gradient" size="sm">Start gratis</Button>
            </Link>
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
              {[
                ["Features", "#features"],
                ["Voor wie", "#voor-wie"],
                ["Prijzen", "#prijzen"],
                ["Demo", DEMO],
                ["Login", LOGIN],
              ].map(([label, href]) => (
                <a
                  key={label}
                  href={href}
                  onClick={() => setMenuOpen(false)}
                  className="py-3 text-foreground/80 hover:text-foreground"
                >
                  {label}
                </a>
              ))}
              <Link to={SIGNUP} onClick={() => setMenuOpen(false)} className="mt-2">
                <Button variant="gradient" className="w-full">Start gratis</Button>
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
              "radial-gradient(60% 50% at 50% 0%, hsl(var(--primary) / 0.12), transparent 70%), radial-gradient(40% 40% at 90% 10%, hsl(var(--accent) / 0.08), transparent 70%)",
          }}
        />
        <div className="text-center max-w-3xl mx-auto">
          <Eyebrow>Premium salonsoftware</Eyebrow>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight leading-[1.05]">
            Meer boekingen.<br />
            Minder no-shows.<br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))]">
              Meer rust in je salon.
            </span>
          </h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground leading-relaxed">
            GlowSuite helpt salons groeien met online boekingen, betalingen, abonnementen en slimme automatisering — alles in één premium systeem.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to={SIGNUP} className="w-full sm:w-auto">
              <Button variant="gradient" size="lg" className="w-full sm:w-auto">
                Start gratis proefperiode <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <Link to={DEMO} className="w-full sm:w-auto">
              <Button variant="outline" size="lg" className="w-full sm:w-auto">
                Bekijk demo
              </Button>
            </Link>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            Geen technische kennis nodig. Binnen enkele minuten live.
          </p>
        </div>

        {/* Hero visual mock */}
        <div className="mt-14 sm:mt-20 max-w-5xl mx-auto">
          <div className="relative rounded-2xl border border-border/70 bg-card overflow-hidden shadow-2xl"
               style={{ boxShadow: "0 30px 80px -20px hsl(var(--primary) / 0.25)" }}>
            <div className="flex items-center gap-1.5 px-4 py-3 border-b border-border/60 bg-muted/40">
              <span className="w-2.5 h-2.5 rounded-full bg-destructive/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-warning/60" />
              <span className="w-2.5 h-2.5 rounded-full bg-success/60" />
              <span className="ml-3 text-xs text-muted-foreground">salon.glowsuite.nl/agenda</span>
            </div>
            <div className="p-4 sm:p-6 grid grid-cols-12 gap-3 sm:gap-4 bg-gradient-to-br from-background to-muted/30">
              {/* Sidebar */}
              <div className="col-span-3 hidden sm:block space-y-2">
                {["Dashboard", "Agenda", "Klanten", "Behandelingen", "Abonnementen", "Rapporten"].map((l, i) => (
                  <div key={l} className={`px-3 py-2 rounded-lg text-xs ${i === 1 ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground"}`}>
                    {l}
                  </div>
                ))}
              </div>
              {/* Main */}
              <div className="col-span-12 sm:col-span-9 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { l: "Omzet vandaag", v: "€1.247", t: "+12%" },
                    { l: "Boekingen", v: "23", t: "+5" },
                    { l: "No-shows", v: "0", t: "-100%" },
                  ].map((k) => (
                    <div key={k.l} className="rounded-xl border border-border/60 bg-card p-3">
                      <div className="text-[10px] sm:text-xs text-muted-foreground">{k.l}</div>
                      <div className="text-sm sm:text-lg font-semibold mt-0.5">{k.v}</div>
                      <div className="text-[10px] text-success font-medium">{k.t}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border border-border/60 bg-card p-3 space-y-2">
                  {[
                    { t: "09:00", c: "Sophie · Knippen & föhnen", b: "from-primary to-accent" },
                    { t: "10:30", c: "Lisa · Balayage", b: "from-accent to-primary" },
                    { t: "13:00", c: "Mark · Baard trim", b: "from-primary/80 to-accent/80" },
                    { t: "15:30", c: "Eva · Gel manicure", b: "from-accent/80 to-primary/80" },
                  ].map((a) => (
                    <div key={a.t} className="flex items-center gap-3">
                      <div className="text-[10px] sm:text-xs text-muted-foreground w-10 sm:w-12">{a.t}</div>
                      <div className={`flex-1 rounded-lg px-3 py-2 text-white text-[11px] sm:text-xs font-medium bg-gradient-to-r ${a.b}`}>
                        {a.c}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* PROBLEM */}
      <Section id="voor-wie" className="border-t border-border/60">
        <div className="max-w-2xl">
          <Eyebrow>Herken je dit?</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Je salon draait goed, maar het kan slimmer.</h2>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {problems.map((p) => (
            <Card key={p} className="p-5 flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                <X className="w-4 h-4" />
              </div>
              <p className="text-sm sm:text-base font-medium leading-snug">{p}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* SOLUTION */}
      <Section className="bg-muted/30 border-y border-border/60">
        <div className="max-w-2xl">
          <Eyebrow>Eén systeem</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">GlowSuite brengt alles samen.</h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Geen losse tools, geen gedoe. Eén plek voor je agenda, klanten, betalingen en groei.
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 gap-3">
          {benefits.map((b) => (
            <div key={b} className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border/60">
              <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <span className="font-medium">{b}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* FEATURES */}
      <Section id="features">
        <div className="max-w-2xl">
          <Eyebrow>Alles wat je nodig hebt</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Krachtige features, simpel in gebruik.</h2>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="p-5 hover:border-primary/40 transition-colors group">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold">{f.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{f.desc}</p>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* MONEY */}
      <Section className="bg-muted/30 border-y border-border/60">
        <div className="max-w-2xl">
          <Eyebrow>Meer omzet</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Gebouwd om je salon meer te laten verdienen.</h2>
        </div>
        <div className="mt-10 grid md:grid-cols-3 gap-4">
          {[
            { icon: Clock, title: "Minder no-shows", desc: "Met bevestigingen, reminders en aanbetalingen.", stat: "−80%" },
            { icon: Repeat, title: "Meer herhaalboekingen", desc: "Laat klanten sneller opnieuw boeken.", stat: "+34%" },
            { icon: TrendingUp, title: "Terugkerende omzet", desc: "Verkoop abonnementen en memberships vanuit je salon.", stat: "€1k+/mnd" },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <Card key={c.title} className="p-6">
                <div className="flex items-center justify-between">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Icon className="w-5 h-5" />
                  </div>
                  <div className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))]">
                    {c.stat}
                  </div>
                </div>
                <h3 className="mt-4 font-semibold text-lg">{c.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{c.desc}</p>
              </Card>
            );
          })}
        </div>
        <div className="mt-10 text-center">
          <Link to={SIGNUP}>
            <Button variant="gradient" size="lg">
              Ik wil mijn salon slimmer laten groeien <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </Link>
        </div>
      </Section>

      {/* HOW IT WORKS */}
      <Section>
        <div className="max-w-2xl">
          <Eyebrow>Zo werkt het</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">In 3 stappen live.</h2>
        </div>
        <div className="mt-10 grid md:grid-cols-3 gap-5">
          {[
            { n: "01", t: "Stel je salon in", d: "Voeg behandelingen, tijden en medewerkers toe." },
            { n: "02", t: "Zet online boeken live", d: "Plaats de widget op je website of deel je boekingslink." },
            { n: "03", t: "Laat GlowSuite meewerken", d: "Bevestigingen, betalingen, rapportages en automatiseringen draaien mee." },
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

      {/* PRICING TEASER */}
      <Section id="prijzen" className="bg-muted/30 border-y border-border/60">
        <div className="max-w-3xl mx-auto text-center">
          <Eyebrow>Eerlijke prijzen</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Betaalbaar voor kleine salons. Krachtig genoeg voor groei.
          </h2>
          <div className="mt-8 inline-flex flex-col items-center p-8 rounded-2xl border border-border/70 bg-card"
               style={{ boxShadow: "0 20px 60px -20px hsl(var(--primary) / 0.2)" }}>
            <div className="text-sm text-muted-foreground">Vanaf</div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-5xl font-bold">€39</span>
              <span className="text-muted-foreground">/maand</span>
            </div>
            <p className="text-sm text-muted-foreground mt-3 max-w-xs">
              Geen verborgen kosten. Schaal mee wanneer je salon groeit.
            </p>
            <div className="mt-5 flex flex-col sm:flex-row gap-2 w-full">
              <Link to={SIGNUP} className="flex-1">
                <Button variant="gradient" className="w-full">Start gratis</Button>
              </Link>
              <a href="#prijzen" className="flex-1">
                <Button variant="outline" className="w-full">Bekijk prijzen</Button>
              </a>
            </div>
          </div>
        </div>
      </Section>

      {/* TESTIMONIALS */}
      <Section>
        <div className="max-w-2xl">
          <Eyebrow>Wat salons zeggen</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">Salons die kiezen voor rust en groei.</h2>
        </div>
        <div className="mt-10 grid md:grid-cols-3 gap-4">
          {[
            { q: "Eindelijk één systeem voor boekingen, betalingen en klanten.", a: "Salon eigenaar" },
            { q: "GlowSuite voelt veel moderner dan wat we hiervoor gebruikten.", a: "Beauty studio" },
            { q: "Onze afspraken en betalingen zijn veel overzichtelijker.", a: "Barbershop" },
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
      <Section className="text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight">
            Klaar om je salon{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))]">
              slimmer te laten draaien?
            </span>
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">
            Start vandaag met online boeken, betalingen en meer overzicht.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to={SIGNUP} className="w-full sm:w-auto">
              <Button variant="gradient" size="lg" className="w-full sm:w-auto">
                Start gratis proefperiode <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <Link to={DEMO} className="w-full sm:w-auto">
              <Button variant="outline" size="lg" className="w-full sm:w-auto">Bekijk demo</Button>
            </Link>
          </div>
        </div>
      </Section>

      {/* FOOTER */}
      <footer className="border-t border-border/60 px-5 sm:px-8 py-10">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src={logoIcon} alt="GlowSuite" className="w-7 h-7 rounded-lg" />
            <span className="text-sm text-muted-foreground">© {new Date().getFullYear()} GlowSuite</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#prijzen" className="hover:text-foreground">Prijzen</a>
            <Link to={LOGIN} className="hover:text-foreground">Login</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
