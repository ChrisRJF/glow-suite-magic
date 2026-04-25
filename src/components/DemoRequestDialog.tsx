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
import { CheckCircle2, Loader2 } from "lucide-react";
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
      <DialogContent className="sm:max-w-lg">
        {done ? (
          <div className="text-center py-6">
            <div className="mx-auto w-14 h-14 rounded-full bg-success/10 text-success flex items-center justify-center mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <DialogTitle className="text-2xl">Bedankt voor je aanvraag!</DialogTitle>
            <DialogDescription className="mt-2 text-base">
              We nemen binnen 1 werkdag contact met je op om een demo in te plannen.
              In de tussentijd kun je vrijblijvend rondkijken in de live demo-omgeving.
            </DialogDescription>
            <div className="mt-6 flex gap-2 justify-center">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Sluiten</Button>
              <Button asChild>
                <a href="/login?demo=1">Open demo</a>
              </Button>
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
