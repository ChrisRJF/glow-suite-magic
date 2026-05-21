import { useState } from "react";
import { z } from "zod";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  salon_name: z.string().trim().min(2, "Vul je salonnaam in").max(160),
  name: z.string().trim().min(2, "Vul je naam in").max(120),
  email: z.string().trim().email("Vul een geldig e-mailadres in").max(255),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  current_system: z.string().trim().max(120).optional().or(z.literal("")),
  message: z.string().trim().max(2000).optional().or(z.literal("")),
});

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  source?: string;
};

export function MigrationHelpDialog({ open, onOpenChange, source = "migration-help" }: Props) {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    salon_name: "",
    name: "",
    email: "",
    phone: "",
    current_system: "",
    message: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function reset() {
    setForm({ salon_name: "", name: "", email: "", phone: "", current_system: "", message: "" });
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
        salon_name: parsed.data.salon_name,
        name: parsed.data.name,
        email: parsed.data.email,
        phone: parsed.data.phone || null,
        current_system: parsed.data.current_system || null,
        message: parsed.data.message || null,
        source,
      };
      const { error } = await supabase.functions.invoke("send-migration-help", { body: payload });
      if (error) throw error;
      setDone(true);
      toast({ title: "Aanvraag verstuurd", description: "We nemen binnen 1 werkdag contact op." });
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
          <div className="py-1 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-success/10 text-success flex items-center justify-center mb-3 ring-8 ring-success/5">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <DialogTitle className="text-xl sm:text-2xl">Aanvraag ontvangen</DialogTitle>
            <DialogDescription className="mt-2 text-sm sm:text-base">
              Bedankt {form.name ? form.name.split(" ")[0] : ""}. Een specialist neemt binnen 1 werkdag persoonlijk contact op om je overstap rustig door te nemen.
            </DialogDescription>
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-xs sm:text-sm font-medium">
              <Clock className="w-4 h-4" />
              <span>Reactie binnen 1 werkdag</span>
            </div>
            <div className="mt-6 flex justify-center">
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Sluiten</Button>
            </div>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Overstap hulp aanvragen</DialogTitle>
              <DialogDescription>
                Laat je gegevens achter. We nemen binnen 1 werkdag persoonlijk contact op om je overstap rustig door te nemen.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={onSubmit} className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label htmlFor="mh-salon">Salonnaam *</Label>
                <Input
                  id="mh-salon"
                  value={form.salon_name}
                  onChange={(e) => setForm({ ...form, salon_name: e.target.value })}
                  placeholder="Studio Nova"
                  required
                />
                {errors.salon_name && <p className="text-xs text-destructive">{errors.salon_name}</p>}
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mh-name">Naam *</Label>
                  <Input
                    id="mh-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Sara Janssen"
                    autoComplete="name"
                    required
                  />
                  {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mh-email">E-mail *</Label>
                  <Input
                    id="mh-email"
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
                  <Label htmlFor="mh-phone">Telefoon</Label>
                  <Input
                    id="mh-phone"
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    placeholder="06 12345678"
                    autoComplete="tel"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mh-system">Huidig systeem</Label>
                  <Input
                    id="mh-system"
                    value={form.current_system}
                    onChange={(e) => setForm({ ...form, current_system: e.target.value })}
                    placeholder="Bijv. Salonized, Treatwell, Excel"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mh-msg">Korte toelichting</Label>
                <Textarea
                  id="mh-msg"
                  rows={3}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  placeholder="Waar wil je vooral hulp bij? (bv. klanten importeren, agenda overzetten)"
                />
              </div>

              <p className="text-xs text-muted-foreground">
                Door te verzenden ga je akkoord dat we je benaderen over je overstap naar GlowSuite. Geen spam, ooit.
              </p>

              <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
                  Annuleren
                </Button>
                <Button type="submit" disabled={submitting} className="w-full sm:w-auto">
                  {submitting && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                  Verstuur aanvraag
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
