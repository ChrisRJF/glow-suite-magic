import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Send, Save, X, Users, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDemoMode } from "@/hooks/useDemoMode";
import { simulateDemoAction } from "@/lib/demoMode";

export type AudienceType = "all" | "upcoming" | "inactive_4w" | "manual";

export type CampaignDraft = {
  id?: string;
  title: string;
  message: string;
  audience: AudienceType;
  status?: string;
};

const AUDIENCE_LABELS: Record<AudienceType, string> = {
  all: "Alle klanten",
  upcoming: "Klanten met komende afspraak",
  inactive_4w: "Klanten zonder afspraak in 4 weken",
  manual: "Handmatig (later)",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: CampaignDraft;
  userId: string;
  onSaved: () => void;
}

type Recipient = { id: string; name: string; phone: string };

export function WhatsAppCampaignEditor({ open, onOpenChange, initial, userId, onSaved }: Props) {
  const [title, setTitle] = useState(initial.title);
  const [message, setMessage] = useState(initial.message);
  const [audience, setAudience] = useState<AudienceType>(initial.audience || "all");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [usage, setUsage] = useState<{ used: number; limit: number } | null>(null);

  useEffect(() => {
    setTitle(initial.title);
    setMessage(initial.message);
    setAudience((initial.audience as AudienceType) || "all");
  }, [initial.id, initial.title, initial.message, initial.audience]);

  // Load recipients & usage whenever audience changes
  useEffect(() => {
    if (!open || !userId) return;
    void loadRecipients();
    void loadUsage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId, audience]);

  const loadUsage = async () => {
    const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const { data } = await supabase
      .from("whatsapp_usage_monthly" as any)
      .select("billable_count, included_limit")
      .eq("user_id", userId)
      .eq("month", month)
      .maybeSingle();
    const { data: s } = await supabase
      .from("whatsapp_settings")
      .select("monthly_included_messages")
      .eq("user_id", userId)
      .maybeSingle();
    setUsage({
      used: (data as any)?.billable_count ?? 0,
      limit: (data as any)?.included_limit ?? (s as any)?.monthly_included_messages ?? 300,
    });
  };

  const loadRecipients = async () => {
    setLoadingRecipients(true);
    try {
      const { data: customers } = await supabase
        .from("customers")
        .select("id, name, phone, whatsapp_opt_in")
        .eq("user_id", userId);

      const eligible = (customers || []).filter(
        (c: any) => c.phone && c.phone.trim() !== "" && c.whatsapp_opt_in !== false,
      );

      if (audience === "all" || audience === "manual") {
        setRecipients(eligible.map((c: any) => ({ id: c.id, name: c.name, phone: c.phone })));
      } else if (audience === "upcoming") {
        const { data: appts } = await supabase
          .from("appointments")
          .select("customer_id")
          .eq("user_id", userId)
          .gte("appointment_date", new Date().toISOString())
          .not("status", "in", "(geannuleerd,cancelled)");
        const ids = new Set((appts || []).map((a: any) => a.customer_id).filter(Boolean));
        setRecipients(eligible.filter((c: any) => ids.has(c.id)).map((c: any) => ({ id: c.id, name: c.name, phone: c.phone })));
      } else if (audience === "inactive_4w") {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 28);
        const { data: appts } = await supabase
          .from("appointments")
          .select("customer_id, appointment_date")
          .eq("user_id", userId)
          .gte("appointment_date", cutoff.toISOString());
        const recent = new Set((appts || []).map((a: any) => a.customer_id).filter(Boolean));
        setRecipients(eligible.filter((c: any) => !recent.has(c.id)).map((c: any) => ({ id: c.id, name: c.name, phone: c.phone })));
      }
    } finally {
      setLoadingRecipients(false);
    }
  };

  const remaining = usage ? Math.max(0, usage.limit - usage.used) : 0;
  const exceedsIncluded = usage ? recipients.length > remaining : false;

  const personalize = (tmpl: string, name: string) =>
    tmpl.replace(/\{naam\}|\{\{customer_name\}\}|\{\{name\}\}/gi, name || "");

  const saveDraft = async (statusOverride?: string) => {
    setSaving(true);
    try {
      const payload: any = {
        title: title.trim() || "Naamloze campagne",
        message,
        audience,
        type: "whatsapp",
        status: statusOverride || initial.status || "concept",
        user_id: userId,
      };
      if (initial.id) {
        const { error } = await supabase.from("campaigns").update(payload).eq("id", initial.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("campaigns").insert(payload);
        if (error) throw error;
      }
      toast.success("Concept opgeslagen");
      onSaved();
    } catch (e: any) {
      toast.error("Opslaan mislukt: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    if (!testPhone) { toast.error("Vul een telefoonnummer in voor de test"); return; }
    if (!message.trim()) { toast.error("Bericht is leeg"); return; }
    setSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          user_id: userId,
          to: testPhone,
          message: personalize(message, "Test"),
          kind: "campaign_test",
          test: true,
          meta: { campaign_id: initial.id, campaign_title: title },
        },
      });
      if (error || !(data as any)?.success) {
        const ctx: any = (error as any)?.context;
        let parsed: any = null;
        try { parsed = ctx ? await ctx.json() : null; } catch {}
        toast.error("Testbericht kon niet worden verstuurd: " + (parsed?.error || (data as any)?.error || "onbekend"));
      } else {
        toast.success("Testbericht verstuurd ✅");
      }
    } catch (e: any) {
      toast.error("Test mislukt: " + e.message);
    } finally {
      setSendingTest(false);
    }
  };

  const sendNow = async () => {
    if (recipients.length === 0) { toast.error("Geen ontvangers met telefoonnummer"); return; }
    setSending(true);
    try {
      // Save campaign first
      let campaignId = initial.id;
      const payload: any = {
        title: title.trim() || "Naamloze campagne",
        message,
        audience,
        type: "whatsapp",
        status: "verzonden",
        sent_count: recipients.length,
        user_id: userId,
      };
      if (campaignId) {
        await supabase.from("campaigns").update(payload).eq("id", campaignId);
      } else {
        const { data: ins } = await supabase.from("campaigns").insert(payload).select("id").single();
        campaignId = (ins as any)?.id;
      }

      let sent = 0;
      let failed = 0;
      for (const r of recipients) {
        try {
          const { data, error } = await supabase.functions.invoke("whatsapp-send", {
            body: {
              user_id: userId,
              to: r.phone,
              message: personalize(message, r.name),
              customer_id: r.id,
              kind: "campaign",
              meta: { campaign_id: campaignId, campaign_title: title },
            },
          });
          if (error || !(data as any)?.success) failed++; else sent++;
        } catch {
          failed++;
        }
      }
      toast.success(`Campagne verzonden: ${sent} verstuurd${failed > 0 ? `, ${failed} mislukt` : ""}`);
      onSaved();
      setConfirmOpen(false);
      onOpenChange(false);
    } catch (e: any) {
      toast.error("Verzenden mislukt: " + e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-4 sm:p-6 w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle>{initial.id ? "Campagne bewerken" : "Nieuwe campagne"}</DialogTitle>
            <DialogDescription>WhatsApp bericht naar geselecteerde klanten.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">Titel</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lente actie" className="h-11" />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Ontvangers</label>
              <Select value={audience} onValueChange={(v) => setAudience(v as AudienceType)}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(AUDIENCE_LABELS) as AudienceType[]).map((k) => (
                    <SelectItem key={k} value={k}>{AUDIENCE_LABELS[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Users className="w-3.5 h-3.5" />
                {loadingRecipients ? (
                  <span>Bezig met tellen...</span>
                ) : (
                  <span>{recipients.length} ontvangers met telefoonnummer</span>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium">Bericht</label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={7}
                className="min-h-[160px] text-base sm:text-sm"
                placeholder="Hoi {naam}! We hebben een leuke actie voor je 💜"
              />
              <p className="text-[11px] text-muted-foreground">Gebruik <code className="bg-secondary px-1 rounded">{"{naam}"}</code> voor de klantnaam.</p>
            </div>

            {usage && (
              <div className={`p-3 rounded-xl text-xs ${exceedsIncluded ? "bg-warning/10 border border-warning/30 text-warning" : "bg-secondary/50 text-muted-foreground"}`}>
                <div className="flex items-start gap-2">
                  {exceedsIncluded && <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                  <div>
                    <p className="font-medium">Geschat verbruik: {recipients.length} berichten</p>
                    <p>Resterend tegoed: {remaining} / {usage.limit}</p>
                    {exceedsIncluded && (
                      <p className="mt-1">Deze campagne gebruikt meer berichten dan je inbegrepen tegoed. Extra berichten kunnen achteraf worden gefactureerd.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="border-t border-border pt-3 space-y-2">
              <label className="text-xs font-medium">Test versturen</label>
              <div className="flex flex-col sm:flex-row gap-2">
                <Input
                  className="flex-1 h-11"
                  placeholder="+31612345678"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                />
                <Button onClick={sendTest} disabled={sendingTest || !testPhone || !message.trim()} variant="outline" className="h-11">
                  {sendingTest ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Test versturen
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2 mt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)} className="h-11">
              <X className="w-4 h-4" /> Annuleren
            </Button>
            <Button variant="outline" onClick={() => saveDraft()} disabled={saving} className="h-11">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Concept opslaan
            </Button>
            <Button
              variant="gradient"
              onClick={() => setConfirmOpen(true)}
              disabled={recipients.length === 0 || !message.trim()}
              className="h-11"
            >
              <Send className="w-4 h-4" /> Nu verzenden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm send dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-md w-[calc(100%-2rem)] sm:w-full">
          <DialogHeader>
            <DialogTitle>Campagne nu verzenden?</DialogTitle>
            <DialogDescription>
              Je staat op het punt om dit bericht naar <strong>{recipients.length} klanten</strong> te sturen via WhatsApp.
            </DialogDescription>
          </DialogHeader>
          {exceedsIncluded && (
            <div className="p-3 rounded-xl bg-warning/10 border border-warning/30 text-xs text-warning">
              Deze campagne gebruikt meer berichten dan je inbegrepen tegoed. Extra berichten kunnen achteraf worden gefactureerd.
            </div>
          )}
          <DialogFooter className="flex flex-col-reverse sm:flex-row gap-2">
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={sending} className="h-11">Annuleren</Button>
            <Button variant="gradient" onClick={sendNow} disabled={sending} className="h-11">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Ja, {recipients.length} berichten versturen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
