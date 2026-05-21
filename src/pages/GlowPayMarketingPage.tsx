import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  CreditCard, Smartphone, QrCode, Send, BookOpen, Wallet,
  Shield, Zap, ArrowRight, CheckCircle2, Building2, Sparkles,
  Receipt, Calendar, Users, Lock, Globe,
} from "lucide-react";
import { GlowSuiteLogo } from "@/components/GlowSuiteLogo";
import { DemoRequestDialog } from "@/components/DemoRequestDialog";
import { MigrationHelpDialog } from "@/components/MigrationHelpDialog";
import { useTrackOnMount } from "@/hooks/useAnalytics";
import sunmiP2 from "@/assets/glowpay/sunmi-p3-hand.webp";
import sunmiP3 from "@/assets/glowpay/sunmi-p3-orange.jpeg";
import sunmiFeatures from "@/assets/glowpay/sunmi-features.jpeg";
import sunmiBrand from "@/assets/glowpay/sunmi-brand.jpeg";
import vivaTerminal from "@/assets/glowpay/viva-terminal.jpeg";
import idealLogo from "@/assets/payment-logos/ideal-wero.svg";
import bancontactLogo from "@/assets/payment-logos/bancontact.svg";
import visaLogo from "@/assets/payment-logos/visa.svg";
import mastercardLogo from "@/assets/payment-logos/mastercard.svg";

const SIGNUP = "/login?mode=signup";

function Section({ id, className = "", children }: { id?: string; className?: string; children: React.ReactNode }) {
  return (
    <section id={id} className={`w-full px-5 sm:px-8 py-14 sm:py-20 ${className}`}>
      <div className="max-w-6xl mx-auto">{children}</div>
    </section>
  );
}

function Eyebrow({ children, icon: Icon = Sparkles, dark = false }: { children: React.ReactNode; icon?: any; dark?: boolean }) {
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase mb-4 ${
      dark ? "bg-white/10 text-white/90 border border-white/15" : "bg-primary/10 text-primary"
    }`}>
      <Icon className="w-3.5 h-3.5" />
      {children}
    </div>
  );
}

export default function GlowPayMarketingPage() {
  useTrackOnMount("glowpay_marketing_view");
  const [demoOpen, setDemoOpen] = useState(false);
  const [migrationOpen, setMigrationOpen] = useState(false);

  const features = [
    {
      icon: Wallet,
      title: "Online vooruitbetalingen",
      desc: "Aanbetalingen bij online boekingen, minder no-shows. Restbetaling in de salon en automatische verwerking.",
    },
    {
      icon: Send,
      title: "Betaalverzoeken",
      desc: "Stuur een betaalverzoek in een paar tikken. Ideaal voor no-shows of open bedragen. Direct gekoppeld aan klant en afspraak.",
    },
    {
      icon: CreditCard,
      title: "Pinbetalingen in de salon",
      desc: "Geen losse pinbedragen meer. Direct gekoppeld aan de afspraak en automatisch verwerkt in je administratie.",
    },
    {
      icon: Smartphone,
      title: "Tap to Pay",
      desc: "Je smartphone of tablet als betaalterminal. Geen extra hardware nodig. Contactloos betalen, onderdeel van GlowPay.",
    },
    {
      icon: BookOpen,
      title: "Boekhouding & administratie",
      desc: "Automatische verwerking, minder handmatig werk en minder fouten. Eén overzicht voor je dag, week en maand.",
    },
  ];

  const paymentMethods = [
    { name: "iDEAL", logo: idealLogo },
    { name: "Bancontact", logo: bancontactLogo },
    { name: "Apple Pay", icon: Smartphone },
    { name: "Google Pay", icon: Smartphone },
    { name: "Visa", logo: visaLogo },
    { name: "Mastercard", logo: mastercardLogo },
    { name: "Contactloos", icon: CreditCard },
    { name: "QR betalingen", icon: QrCode },
  ];

  return (
    <div className="min-h-[100dvh] bg-background text-foreground antialiased overflow-x-hidden">
      <DemoRequestDialog open={demoOpen} onOpenChange={setDemoOpen} source="glowpay-marketing" />
      <MigrationHelpDialog open={migrationOpen} onOpenChange={setMigrationOpen} />

      {/* NAV */}
      <header className="sticky top-0 z-50 w-full bg-background/85 backdrop-blur-xl border-b border-border/60">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5" aria-label="GlowSuite">
            <GlowSuiteLogo size="md" withWordmark priority />
          </Link>
          <nav className="hidden md:flex items-center gap-7 text-sm text-muted-foreground">
            <Link to="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link to="/prijzen" className="hover:text-foreground transition-colors">Prijzen</Link>
            <span className="text-foreground font-medium">GlowPay</span>
          </nav>
          <div className="flex items-center gap-3">
            <Link to={SIGNUP}>
              <Button variant="gradient" size="sm">Start met GlowPay</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* HERO — dark premium */}
      <section className="relative overflow-hidden bg-[#0a0a14] text-white">
        <div
          aria-hidden
          className="absolute inset-0 opacity-90"
          style={{
            background:
              "radial-gradient(60% 50% at 15% 0%, hsl(var(--primary) / 0.35), transparent 70%), radial-gradient(50% 50% at 100% 100%, hsl(var(--accent) / 0.25), transparent 70%)",
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }}
        />
        <div className="relative max-w-6xl mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-20 sm:pb-28">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <Eyebrow icon={Shield} dark>Veilig betalen met GlowPay</Eyebrow>
              <h1 className="text-[36px] sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.05] text-balance">
                Betalingen die gewoon{" "}
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))]">
                  meelopen met je salon.
                </span>
              </h1>
              <p className="mt-5 text-base sm:text-xl text-white/70 leading-relaxed max-w-xl">
                Van online betalingen en Tap to Pay tot pinbetalingen in de salon. Alles direct gekoppeld aan afspraken, omzet en boekhouding in GlowSuite.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row gap-3 max-w-md sm:max-w-none">
                <Link to={SIGNUP} className="w-full sm:w-auto">
                  <Button variant="gradient" size="lg" className="w-full sm:w-auto">
                    Start met GlowPay <ArrowRight className="w-4 h-4 ml-1.5" />
                  </Button>
                </Link>
                <a href="#oplossingen" className="w-full sm:w-auto">
                  <Button
                    variant="outline"
                    size="lg"
                    className="w-full sm:w-auto bg-white/5 border-white/20 text-white hover:bg-white/10 hover:text-white"
                  >
                    Bekijk betaaloplossingen
                  </Button>
                </a>
              </div>
              <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-white/55">
                <span className="inline-flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Europese betaalpartner</span>
                <span className="inline-flex items-center gap-1.5"><Zap className="w-3.5 h-3.5" /> Snelle uitbetalingen</span>
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="w-3.5 h-3.5" /> Geïntegreerd met GlowSuite</span>
              </div>
            </div>

            {/* HERO VISUAL: stacked payment cards */}
            <div className="relative">
              <div className="relative mx-auto max-w-md">
                <div
                  className="absolute -inset-6 rounded-[2rem] opacity-60 blur-2xl"
                  style={{ background: "linear-gradient(135deg, hsl(var(--primary) / 0.5), hsl(var(--accent) / 0.5))" }}
                />
                <div className="relative rounded-3xl bg-gradient-to-br from-[#15152a] to-[#0a0a14] border border-white/10 p-6 shadow-2xl">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] flex items-center justify-center">
                        <Wallet className="w-4 h-4 text-white" />
                      </div>
                      <span className="text-sm font-semibold">GlowPay</span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
                    </span>
                  </div>
                  <div className="text-xs text-white/50 uppercase tracking-wide font-semibold">Vandaag ontvangen</div>
                  <div className="mt-1 text-4xl font-bold tabular-nums tracking-tight">€ 1.847,50</div>
                  <div className="mt-5 space-y-2.5">
                    {[
                      { label: "Aanbetaling · Anna B.", amount: "€ 25,00", method: "iDEAL" },
                      { label: "Pin · Color & cut", amount: "€ 89,00", method: "Tap to Pay" },
                      { label: "Betaalverzoek · Lisa K.", amount: "€ 145,00", method: "iDEAL" },
                      { label: "Pin · Brow shape", amount: "€ 35,00", method: "Contactloos" },
                    ].map((r) => (
                      <div key={r.label} className="flex items-center justify-between rounded-xl bg-white/5 border border-white/10 px-3.5 py-2.5">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{r.label}</div>
                          <div className="text-[11px] text-white/50">{r.method}</div>
                        </div>
                        <div className="text-sm font-semibold tabular-nums">{r.amount}</div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 pt-4 border-t border-white/10 flex items-center justify-between text-[11px] text-white/55">
                    <span>Automatisch verwerkt in administratie</span>
                    <span>Bijgewerkt zojuist</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* OPERATIONAL POSITIONING */}
      <Section className="border-b border-border/60">
        <div className="max-w-2xl">
          <Eyebrow icon={Sparkles}>Eén systeem</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Geen losse betaalprovider meer.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Betalingen, afspraken en administratie werken samen. Minder losse handelingen, minder administratie, meer rust.
          </p>
        </div>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { icon: Calendar, t: "Gekoppeld aan afspraken", d: "Elke betaling hangt aan de juiste afspraak en klant." },
            { icon: Users, t: "Gekoppeld aan klanten", d: "Aanbetalingen, restbetalingen en historie op één plek." },
            { icon: Receipt, t: "Gekoppeld aan kassa", d: "Pin en online stromen samen in dezelfde dagstaat." },
            { icon: BookOpen, t: "Gekoppeld aan boekhouding", d: "Automatische verwerking, klaar voor je boekhouder." },
          ].map((c) => {
            const Icon = c.icon;
            return (
              <Card key={c.t} className="p-5 bg-card/70">
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-3">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="font-semibold">{c.t}</div>
                <div className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{c.d}</div>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* FEATURES */}
      <Section id="oplossingen" className="bg-muted/30 border-b border-border/60">
        <div className="max-w-2xl">
          <Eyebrow icon={Wallet}>Betaaloplossingen</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Alles wat je salon nodig heeft om betaald te worden.
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">
            Online, mobiel en in de salon. Eén integratie, één overzicht.
          </p>
        </div>
        <div className="mt-10 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title} className="p-6 bg-background border-border/60 hover:shadow-lg hover:shadow-primary/5 transition-shadow">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center mb-4 text-white"
                  style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))" }}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-lg">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </Card>
            );
          })}
        </div>
      </Section>

      {/* PAYMENT METHODS */}
      <Section>
        <div className="text-center max-w-2xl mx-auto">
          <Eyebrow icon={CreditCard}>Ondersteunde betaalmethoden</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Klanten betalen zoals zij willen.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Online, mobiel en aan de kassa. Alle veelgebruikte betaalmethoden zijn ingebouwd.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {paymentMethods.map((m: any) => (
            <div
              key={m.name}
              className="aspect-[5/3] rounded-xl border border-border/60 bg-card flex flex-col items-center justify-center gap-1.5 px-2 hover:border-primary/40 transition-colors"
            >
              {m.logo ? (
                <img src={m.logo} alt={m.name} className="h-7 w-auto object-contain" />
              ) : (
                <m.icon className="w-6 h-6 text-foreground/70" />
              )}
              <span className="text-[10px] text-muted-foreground font-medium">{m.name}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* HARDWARE */}
      <section className="relative overflow-hidden bg-[#0a0a14] text-white py-20 sm:py-28">
        <div
          aria-hidden
          className="absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(50% 50% at 80% 20%, hsl(var(--primary) / 0.25), transparent 70%), radial-gradient(50% 50% at 20% 80%, hsl(var(--accent) / 0.18), transparent 70%)",
          }}
        />
        <div className="relative max-w-6xl mx-auto px-5 sm:px-8">
          <div className="max-w-2xl">
            <Eyebrow icon={CreditCard} dark>Pinapparaten</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Professionele betaalervaring, direct gekoppeld aan GlowSuite.
            </h2>
            <p className="mt-4 text-white/65 text-lg">
              Geselecteerde Sunmi terminals met contactloos betalen, QR betalingen en Tap to Pay ondersteuning. Vooraf ingesteld voor GlowPay.
            </p>
          </div>

          <div className="mt-12 grid md:grid-cols-2 gap-6">
            {/* Sunmi P2 SmartPad */}
            <div className="rounded-3xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/10 overflow-hidden">
              <div className="relative bg-gradient-to-br from-[#1a0f1a] to-[#0a0a14] aspect-[4/3] flex items-center justify-center p-6">
                <img src={sunmiP2} alt="Sunmi P2 SmartPad pinapparaat" className="max-h-full w-auto object-contain drop-shadow-2xl" />
              </div>
              <div className="p-6">
                <div className="text-[11px] uppercase tracking-wide text-white/50 font-semibold">Smartpad</div>
                <h3 className="mt-1 text-xl font-semibold">Sunmi P2 SmartPad</h3>
                <p className="mt-2 text-sm text-white/65 leading-relaxed">
                  Volledig Android pinapparaat met groot touchscreen. Contactloos, chip, QR en bonprinter. Geschikt voor de balie en mobiel gebruik in de salon.
                </p>
                <ul className="mt-4 space-y-1.5 text-sm text-white/70">
                  {["Contactloos betalen", "QR betalingen", "Tap to Pay ondersteuning", "Geïntegreerd met GlowSuite"].map((i) => (
                    <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />{i}</li>
                  ))}
                </ul>
                <div className="mt-5 flex gap-2.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white/5 border-white/20 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => setDemoOpen(true)}
                  >
                    Bekijk apparaat
                  </Button>
                  <Button variant="gradient" size="sm" onClick={() => setDemoOpen(true)}>
                    Bestellen
                  </Button>
                </div>
              </div>
            </div>

            {/* Sunmi P3 Scanner */}
            <div className="rounded-3xl bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/10 overflow-hidden">
              <div className="relative bg-gradient-to-br from-[#1a0a0a] to-[#0a0a14] aspect-[4/3] flex items-center justify-center p-6">
                <img src={sunmiP3} alt="Sunmi P3 Scanner pinapparaat" className="max-h-full w-auto object-contain drop-shadow-2xl" />
                {/* GlowSuite "brand on screen" badge overlay */}
                <div className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full bg-white/10 backdrop-blur border border-white/15 px-2.5 py-1 text-[10px] text-white/80">
                  <Sparkles className="w-3 h-3" /> Brand: GlowSuite
                </div>
              </div>
              <div className="p-6">
                <div className="text-[11px] uppercase tracking-wide text-white/50 font-semibold">Scanner Terminal</div>
                <h3 className="mt-1 text-xl font-semibold">Sunmi P3 Scanner</h3>
                <p className="mt-2 text-sm text-white/65 leading-relaxed">
                  Tweede scherm voor klanten, ingebouwde scanner en snel contactloos betalen. Het splash-logo kan worden vervangen door je GlowSuite branding.
                </p>
                <ul className="mt-4 space-y-1.5 text-sm text-white/70">
                  {["Klantscherm met logo", "QR scanner ingebouwd", "Tap to Pay ondersteuning", "Geïntegreerd met GlowSuite"].map((i) => (
                    <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />{i}</li>
                  ))}
                </ul>
                <div className="mt-5 flex gap-2.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-white/5 border-white/20 text-white hover:bg-white/10 hover:text-white"
                    onClick={() => setDemoOpen(true)}
                  >
                    Bekijk apparaat
                  </Button>
                  <Button variant="gradient" size="sm" onClick={() => setDemoOpen(true)}>
                    Bestellen
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Hardware features strip */}
          <div className="mt-10 grid sm:grid-cols-3 gap-4">
            {[
              { icon: CreditCard, t: "Contactloos", d: "Snel tikken voor betalingen tot en met grote bedragen." },
              { icon: QrCode, t: "QR betalingen", d: "Voor digitale wallets en betaalverzoeken." },
              { icon: Smartphone, t: "Tap to Pay", d: "Smartphone of tablet als terminal, geen extra hardware." },
            ].map((c) => {
              const Icon = c.icon;
              return (
                <div key={c.t} className="rounded-2xl bg-white/[0.04] border border-white/10 p-5">
                  <Icon className="w-5 h-5 text-[hsl(var(--accent))]" />
                  <div className="mt-3 font-semibold">{c.t}</div>
                  <div className="mt-1 text-sm text-white/60">{c.d}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* COMPARISON */}
      <Section className="border-b border-border/60">
        <div className="max-w-2xl">
          <Eyebrow icon={Zap}>Vandaag vs. met GlowPay</Eyebrow>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Minder administratie. Meer overzicht.
          </h2>
        </div>
        <div className="mt-10 grid md:grid-cols-2 gap-5">
          <Card className="p-6 border-border/60">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">Vandaag</div>
            <h3 className="mt-2 text-xl font-semibold">Losse tools en handwerk</h3>
            <ul className="mt-5 space-y-3 text-sm">
              {[
                "Losse betaalprovider naast je agenda",
                "Pinbedragen handmatig naast afspraken zetten",
                "Open betalingen via WhatsApp najagen",
                "Dagstaat handmatig controleren",
                "Boekhouding rommelig en achterop",
              ].map((i) => (
                <li key={i} className="flex items-start gap-2.5 text-muted-foreground">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                  <span>{i}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card
            className="p-6 border-primary/30 relative overflow-hidden"
            style={{ background: "linear-gradient(180deg, hsl(var(--primary) / 0.06), transparent 60%)" }}
          >
            <div className="text-xs uppercase tracking-wide text-primary font-semibold">Met GlowPay</div>
            <h3 className="mt-2 text-xl font-semibold">Automatisch gekoppeld</h3>
            <ul className="mt-5 space-y-3 text-sm">
              {[
                "Betalingen, afspraken en kassa op één plek",
                "Pin automatisch gekoppeld aan de juiste afspraak",
                "Open bedragen oplossen met één betaalverzoek",
                "Realtime overzicht van dag, week en maand",
                "Boekhouding loopt automatisch mee",
              ].map((i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                  <span>{i}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>

      {/* VIVA TRUST */}
      <Section className="bg-muted/30 border-b border-border/60">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <Eyebrow icon={Shield}>Betaalinfrastructuur</Eyebrow>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              GlowPay werkt samen met Viva.com als betaalinfrastructuur.
            </h2>
            <p className="mt-4 text-muted-foreground text-lg">
              Een Europese betaalpartner met veilige verwerking en snelle uitbetalingen. Jij blijft werken in GlowSuite, Viva.com zorgt op de achtergrond voor een stabiele en gereguleerde betaalstroom.
            </p>
            <ul className="mt-6 grid sm:grid-cols-2 gap-2.5 text-sm">
              {[
                "Europese betaalpartner",
                "Snelle uitbetalingen",
                "Eigen IBAN mogelijk",
                "Veilige verwerking",
                "Dagelijks, wekelijks of maandelijks uitbetalen",
                "Volledig gereguleerd",
              ].map((i) => (
                <li key={i} className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-primary shrink-0" />{i}</li>
              ))}
            </ul>
          </div>
          <div className="relative">
            <div className="rounded-3xl border border-border/60 bg-background p-6 sm:p-8 shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  <Building2 className="w-4 h-4" /> Powered by Viva.com
                </div>
                <span className="text-[11px] text-emerald-600 inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Verbonden
                </span>
              </div>
              <img src={vivaTerminal} alt="Viva.com pinterminal" className="w-full max-w-xs mx-auto h-auto rounded-2xl" />
              <div className="mt-5 grid grid-cols-3 gap-3 text-center">
                {[
                  { label: "Uitbetaling", value: "Dagelijks" },
                  { label: "Eigen IBAN", value: "Optioneel" },
                  { label: "Regio", value: "EU" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl bg-muted/40 border border-border/60 p-2.5">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{s.label}</div>
                    <div className="mt-0.5 text-sm font-semibold">{s.value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* CTA */}
      <section className="relative overflow-hidden bg-[#0a0a14] text-white">
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(50% 60% at 50% 50%, hsl(var(--primary) / 0.4), transparent 70%)",
          }}
        />
        <div className="relative max-w-4xl mx-auto px-5 sm:px-8 py-20 sm:py-24 text-center">
          <h2 className="text-3xl sm:text-5xl font-bold tracking-tight text-balance">
            Klaar voor betalingen die meelopen met je salon?
          </h2>
          <p className="mt-5 text-white/70 text-lg max-w-2xl mx-auto">
            Activeer GlowPay in een paar minuten. Wij helpen graag bij de overstap vanaf je huidige betaalprovider.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center max-w-md sm:max-w-none mx-auto">
            <Link to={SIGNUP} className="w-full sm:w-auto">
              <Button variant="gradient" size="lg" className="w-full sm:w-auto">
                Start met GlowPay <ArrowRight className="w-4 h-4 ml-1.5" />
              </Button>
            </Link>
            <Button
              variant="outline"
              size="lg"
              className="bg-white/5 border-white/20 text-white hover:bg-white/10 hover:text-white"
              onClick={() => setDemoOpen(true)}
            >
              Plan een demo
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="text-white/80 hover:bg-white/10 hover:text-white"
              onClick={() => setMigrationOpen(true)}
            >
              Vraag overstaphulp
            </Button>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-border/60 py-10">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <GlowSuiteLogo size="sm" />
            <span>© {new Date().getFullYear()} GlowSuite</span>
          </div>
          <nav className="flex items-center gap-6">
            <Link to="/" className="hover:text-foreground">Home</Link>
            <Link to="/prijzen" className="hover:text-foreground">Prijzen</Link>
            <Link to={SIGNUP} className="hover:text-foreground">Start gratis</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
