import { useState } from "react";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, Loader2, Mail, PlayCircle, Clock, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().trim().min(2, "Vul je naam in").max(120),
  email: z.string().trim().email("Vul een geldig e-mailadres in").max(255),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  salon_name: z.string().trim().max(160).optional().or(z.literal("")),
  salon_type: z.string().trim().max(60).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
});

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source?: string;
};

const SALON_TYPES = [
  "Kapsalon",
  "Barbershop",
  "Nagelstudio",
  "Brow / Lash studio",
  "Beautysalon",
  "Anders",
];

export function DemoRequestDialog({ open, onOpenChange, source = "landing" }: Props) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    salon_name: "",
    salon_type: "",
    message: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reset() {
    setForm({ name: "", email: "", phone: "", salon_name: "", salon_type: "", message: "" });
    setErrors({});
    setDone(false);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString();
        if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone || null,
        salon_name: parsed.data.salon_name || null,
        salon_type: parsed.data.salon_type || null,
        message: parsed.data.message || null,
        source,
        user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
      };
      const { error } = await supabase.from("demo_requests").insert(payload);
      if (error) throw error;
      setDone(true);
      toast({ title: "Bedankt!", description: "We nemen snel contact met je op." });
    } catch (err: any) {
      toast({
        title: "Verzenden mislukt",
        description: err?.message || "Probeer het later opnieuw.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setTimeout(reset, 200);
      }}
    >
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] sm:max-w-lg max-h-[calc(100vh-2rem)] sm:max-h-[90vh] overflow-y-auto p-4 sm:p-6 rounded-xl">
        {done ? (
          <div className="py-1">
            <div className="text-center">
              <div className="mx-auto w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-success/10 text-success flex items-center justify-center mb-3 sm:mb-4 ring-4 sm:ring-8 ring-success/5">
                <CheckCircle2 className="w-7 h-7 sm:w-8 sm:h-8" />
              </div>
              <DialogTitle className="text-xl sm:text-2xl break-words">
                Bedankt {form.name ? form.name.split(" ")[0] : ""}! 🎉
              </DialogTitle>
              <DialogDescription className="mt-2 text-sm sm:text-base">
                Je aanvraag is binnen. Een GlowSuite-specialist neemt persoonlijk contact op.
              </DialogDescription>

              <div className="mt-3 sm:mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs sm:text-sm font-medium max-w-full">
                <Clock className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">We bellen of mailen binnen 1 werkdag</span>
              </div>
            </div>

            <div className="mt-5 sm:mt-6 space-y-3">
              <p className="text-sm font-semibold text-foreground">Wat gebeurt er nu?</p>
              <ol className="space-y-2 sm:space-y-3">
                <li className="flex gap-3 items-start p-2.5 sm:p-3 rounded-lg border bg-card">
                  <div className="flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">1</div>
                  <div className="text-sm min-w-0 flex-1">
                    <div className="font-medium">Check je inbox</div>
                    <div className="text-muted-foreground break-words">
                      Bevestiging naar <span className="font-medium text-foreground break-all">{form.email}</span>
                    </div>
                  </div>
                </li>
                <li className="flex gap-3 items-start p-2.5 sm:p-3 rounded-lg border bg-card">
                  <div className="flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">2</div>
                  <div className="text-sm min-w-0 flex-1">
                    <div className="font-medium">Persoonlijk gesprek (15 min)</div>
                    <div className="text-muted-foreground">We laten GlowSuite zien op basis van jouw salon.</div>
                  </div>
                </li>
                <li className="flex gap-3 items-start p-2.5 sm:p-3 rounded-lg border bg-card">
                  <div className="flex-shrink-0 w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">3</div>
                  <div className="text-sm min-w-0 flex-1">
                    <div className="font-medium">Gratis proefperiode</div>
                    <div className="text-muted-foreground">Bij interesse direct toegang tot je eigen omgeving.</div>
                  </div>
                </li>
              </ol>
            </div>

            <div className="mt-5 sm:mt-6 p-3 sm:p-4 rounded-lg bg-gradient-to-br from-primary/5 to-primary/10 border border-primary/20">
              <div className="flex items-start gap-3">
                <PlayCircle className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">Niet wachten? Bekijk de demo nu</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Direct door naar de live demo-omgeving.
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">Sluiten</Button>
                <Button asChild size="sm" variant="gradient" className="w-full sm:w-auto">
                  <a href="/login?demo=1">
                    Open live demo <ArrowRight className="w-4 h-4 ml-1" />
                  </a>
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Vraag een persoonlijke demo aan</DialogTitle>
              <DialogDescription>
                Laat je gegevens achter en we nemen binnen 1 werkdag contact op.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4 mt-2">
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dr-name">Naam *</Label>
                  <Input
                    id="dr-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Bijv. Sara Janssen"
                    autoComplete="name"
                    required
                  />
                  {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dr-email">E-mail *</Label>
                  <Input
                    id="dr-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="naam@salon.nl"
                    autoComplete="email"
                    required
                  />
                  {errors.email && <p className="text-xs text-destructive">{errors.email}</p>}
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="dr-phone">Telefoon</Label>
                  <Input
                    id="dr-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="06 12345678"
                    autoComplete="tel"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="dr-salon">Naam salon</Label>
                  <Input
                    id="dr-salon"
                    value={form.salon_name}
                    onChange={(e) => setForm({ ...form, salon_name: e.target.value })}
                    placeholder="Studio Nova"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Type salon</Label>
                <Select
                  value={form.salon_type}
                  onValueChange={(v) => setForm({ ...form, salon_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Kies een type" />
                  </SelectTrigger>
                  <SelectContent>
                    {SALON_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dr-msg">Bericht (optioneel)</Label>
                <Textarea
                  id="dr-msg"
                  rows={3}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder="Waar wil je vooral meer over weten?"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Door te verzenden ga je akkoord dat we je benaderen over GlowSuite. Geen spam, ooit.
              </p>

              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  Annuleren
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  Vraag demo aan
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
