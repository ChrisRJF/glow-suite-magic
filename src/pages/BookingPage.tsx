import { useState } from "react";
import { services, formatEuro } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Check, Clock, ArrowLeft, ArrowRight, Calendar, User } from "lucide-react";
import { cn } from "@/lib/utils";

const availableSlots = ['09:00', '10:00', '11:30', '13:00', '14:30', '16:00', '17:00'];

export default function BookingPage() {
  const [step, setStep] = useState(1);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const service = services.find(s => s.id === selectedService);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border p-5">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl gradient-bg flex items-center justify-center">
            <span className="text-sm font-bold text-primary-foreground">GS</span>
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight">Glow Studio</h1>
            <p className="text-[11px] text-muted-foreground">Online Afspraak Maken</p>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full p-6">
        {/* Steps */}
        <div className="flex items-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-colors",
                step >= s ? 'gradient-bg text-primary-foreground' : 'bg-secondary text-muted-foreground'
              )}>
                {step > s ? <Check className="w-4 h-4" /> : s}
              </div>
              <span className={cn("text-xs font-medium hidden sm:block", step >= s ? 'text-foreground' : 'text-muted-foreground')}>
                {s === 1 ? 'Behandeling' : s === 2 ? 'Tijd' : 'Gegevens'}
              </span>
              {s < 3 && <div className={cn("flex-1 h-px", step > s ? 'bg-primary' : 'bg-border')} />}
            </div>
          ))}
        </div>

        {/* Step 1: Choose Service */}
        {step === 1 && (
          <div className="space-y-3 opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
            <h2 className="text-xl font-bold mb-4">Kies een behandeling</h2>
            {services.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedService(s.id)}
                className={cn(
                  "w-full flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 text-left",
                  selectedService === s.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border bg-secondary/30 hover:bg-secondary/60'
                )}
              >
                <div className="w-2 h-10 rounded-full" style={{ backgroundColor: s.color }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{s.name}</p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{s.duration} min</span>
                  </div>
                </div>
                <p className="text-sm font-bold tabular-nums">{formatEuro(s.price)}</p>
              </button>
            ))}
            <Button
              variant="gradient"
              className="w-full mt-4"
              disabled={!selectedService}
              onClick={() => setStep(2)}
            >
              Volgende <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 2: Choose Time */}
        {step === 2 && (
          <div className="opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
            <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Terug
            </button>
            <h2 className="text-xl font-bold mb-2">Kies een tijdstip</h2>
            <p className="text-sm text-muted-foreground mb-6">
              <Calendar className="w-4 h-4 inline mr-1" />Dinsdag 22 maart 2026
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {availableSlots.map((slot) => (
                <button
                  key={slot}
                  onClick={() => setSelectedTime(slot)}
                  className={cn(
                    "p-3 rounded-xl text-sm font-medium tabular-nums border transition-all duration-200",
                    selectedTime === slot
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border hover:bg-secondary/60'
                  )}
                >
                  {slot}
                </button>
              ))}
            </div>
            <Button
              variant="gradient"
              className="w-full mt-6"
              disabled={!selectedTime}
              onClick={() => setStep(3)}
            >
              Volgende <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Step 3: Enter Details */}
        {step === 3 && (
          <div className="opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
            <button onClick={() => setStep(2)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors">
              <ArrowLeft className="w-4 h-4" /> Terug
            </button>
            <h2 className="text-xl font-bold mb-6">Jouw gegevens</h2>

            {/* Summary */}
            <div className="glass-card p-4 mb-6">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Behandeling</span>
                <span className="font-medium">{service?.name}</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">Tijdstip</span>
                <span className="font-medium">{selectedTime} · Di 22 mrt</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-muted-foreground">Prijs</span>
                <span className="font-bold">{service ? formatEuro(service.price) : ''}</span>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Naam</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Je volledige naam"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full h-11 pl-10 pr-4 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Telefoonnummer</label>
                <input
                  type="tel"
                  placeholder="+31 6 1234 5678"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full h-11 px-4 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <Button
              variant="gradient"
              className="w-full mt-6"
              disabled={!name || !phone}
              onClick={() => alert('Afspraak bevestigd! ✅')}
            >
              <Check className="w-4 h-4" /> Afspraak Bevestigen
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
