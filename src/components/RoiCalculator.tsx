import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Calculator, TrendingUp, ArrowRight, Sparkles } from "lucide-react";

const SIGNUP = "/login?mode=signup";

// Average revenue per appointment in EUR (industry avg salon ticket)
const AVG_TICKET = 55;
// Industry: ~8% of appointments end as no-show. GlowSuite prevents ~70% via WhatsApp reminders.
const NO_SHOW_RATE = 0.08;
const PREVENTION_RATE = 0.7;

function formatEuro(value: number) {
  return new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function RoiCalculator() {
  const [appointments, setAppointments] = useState<number>(120);

  const { estimatedNoShows, preventedNoShows, savings, yearly } = useMemo(() => {
    const estimated = Math.round(appointments * NO_SHOW_RATE);
    const prevented = Math.max(1, Math.round(estimated * PREVENTION_RATE));
    const monthly = prevented * AVG_TICKET;
    return {
      estimatedNoShows: estimated,
      preventedNoShows: prevented,
      savings: monthly,
      yearly: monthly * 12,
    };
  }, [appointments]);

  return (
    <section
      id="roi-calculator"
      className="w-full px-5 sm:px-8 py-12 sm:py-20 lg:py-24 bg-gradient-to-b from-background via-primary/[0.04] to-background border-y border-border/60"
    >
      <div className="max-w-5xl mx-auto">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide uppercase mb-4">
            <Calculator className="w-3.5 h-3.5" />
            ROI Calculator
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
            Bereken hoeveel jij bespaart met GlowSuite.
          </h2>
          <p className="mt-4 text-muted-foreground text-base sm:text-lg leading-relaxed">
            Vul in hoeveel afspraken je per maand hebt en zie direct wat je bespaart aan voorkomen no-shows.
          </p>
        </div>

        <Card
          className="mt-10 p-6 sm:p-10 relative overflow-hidden"
          style={{ boxShadow: "0 24px 60px -24px hsl(var(--primary) / 0.25)" }}
        >
          <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-gradient-to-br from-primary/15 to-accent/10 blur-3xl pointer-events-none" />

          <div className="relative grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
            {/* Input side */}
            <div>
              <label
                htmlFor="appointments"
                className="text-sm font-semibold text-foreground"
              >
                Hoeveel afspraken heb je per maand?
              </label>

              <div className="mt-4 flex items-center gap-3">
                <Input
                  id="appointments"
                  type="number"
                  inputMode="numeric"
                  min={10}
                  max={1000}
                  value={appointments}
                  onChange={(e) => {
                    const v = parseInt(e.target.value || "0", 10);
                    if (!Number.isNaN(v)) setAppointments(Math.max(10, Math.min(1000, v)));
                  }}
                  className="h-12 text-lg font-semibold w-32"
                />
                <span className="text-sm text-muted-foreground">afspraken / maand</span>
              </div>

              <div className="mt-6">
                <Slider
                  value={[appointments]}
                  min={10}
                  max={500}
                  step={5}
                  onValueChange={(v) => setAppointments(v[0])}
                />
                <div className="mt-2 flex justify-between text-xs text-muted-foreground">
                  <span>10</span>
                  <span>250</span>
                  <span>500+</span>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                  <div className="text-xs text-muted-foreground">Geschatte no-shows per maand</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums">{estimatedNoShows}</div>
                </div>
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                  <div className="text-xs text-primary font-semibold">Voorkomen door GlowSuite</div>
                  <div className="mt-1 text-2xl font-bold tabular-nums text-primary">{preventedNoShows}</div>
                </div>
              </div>

              <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
                <Sparkles className="w-3.5 h-3.5 mt-0.5 text-primary shrink-0" />
                <p>
                  Berekening op basis van gemiddelde behandelwaarde van {formatEuro(AVG_TICKET)}, ~8% no-show ratio en 70% preventie via automatische WhatsApp reminders.
                </p>
              </div>
            </div>

            {/* Result side */}
            <div className="relative">
              <div
                className="rounded-2xl p-6 sm:p-8 bg-gradient-to-br from-[hsl(var(--primary))] to-[hsl(var(--accent))] text-white"
                style={{ boxShadow: "0 20px 50px -16px hsl(var(--primary) / 0.5)" }}
              >
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide opacity-90">
                  <TrendingUp className="w-4 h-4" />
                  Jouw besparing
                </div>
                <p className="mt-4 text-base leading-relaxed opacity-95">
                  Als GlowSuite {preventedNoShows} {preventedNoShows === 1 ? "no-show" : "no-shows"} voorkomt, bespaar je
                </p>
                <div className="mt-2 text-4xl sm:text-5xl font-bold tracking-tight tabular-nums">
                  {formatEuro(savings)}
                </div>
                <p className="text-sm opacity-90">per maand</p>

                <div className="mt-5 pt-5 border-t border-white/20 flex items-center justify-between">
                  <span className="text-sm opacity-90">Per jaar</span>
                  <span className="text-xl font-semibold tabular-nums">{formatEuro(yearly)}</span>
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3">
                <Link to={SIGNUP} className="w-full">
                  <Button
                    size="lg"
                    className="w-full h-12 px-8 text-base font-semibold bg-gradient-to-r from-[hsl(var(--primary))] to-[hsl(var(--accent))] hover:opacity-95 text-white border-0"
                    style={{ boxShadow: "0 16px 40px -12px hsl(var(--primary) / 0.45)" }}
                  >
                    Probeer gratis
                    <ArrowRight className="ml-2 w-4 h-4" />
                  </Button>
                </Link>
                <p className="text-xs text-muted-foreground text-center">
                  14 dagen gratis · geen creditcard nodig
                </p>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
