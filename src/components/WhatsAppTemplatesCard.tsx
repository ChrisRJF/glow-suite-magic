import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw, Eye, Send, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  TEMPLATE_LABELS,
  WhatsAppTemplateType,
  renderTemplate,
  SAMPLE_VARS,
} from "@/lib/whatsappTemplates";

type TemplateRow = {
  id?: string;
  user_id: string;
  template_type: WhatsAppTemplateType;
  content: string;
  is_active: boolean;
};

const TYPES: WhatsAppTemplateType[] = ["booking_confirmation", "reminder", "review"];

export function WhatsAppTemplatesCard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Record<WhatsAppTemplateType, TemplateRow>>(() => {
    const init = {} as Record<WhatsAppTemplateType, TemplateRow>;
    for (const t of TYPES) init[t] = { user_id: "", template_type: t, content: DEFAULT_WHATSAPP_TEMPLATES[t], is_active: true };
    return init;
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<WhatsAppTemplateType | null>(null);
  const [previewOpen, setPreviewOpen] = useState<WhatsAppTemplateType | null>(null);
  const [testPhone, setTestPhone] = useState("");
  const [sendingTest, setSendingTest] = useState<WhatsAppTemplateType | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { setLoading(false); return; }
      setUserId(auth.user.id);

      const { data } = await supabase
        .from("whatsapp_templates")
        .select("*")
        .eq("user_id", auth.user.id);

      const next = { ...templates };
      for (const t of TYPES) {
        const existing = (data || []).find((r: any) => r.template_type === t);
        next[t] = existing
          ? { ...existing, template_type: t as WhatsAppTemplateType }
          : { user_id: auth.user.id, template_type: t, content: DEFAULT_WHATSAPP_TEMPLATES[t], is_active: true };
      }
      setTemplates(next);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = async (type: WhatsAppTemplateType, content: string) => {
    if (!userId) return;
    setSaving(type);
    const { error } = await supabase
      .from("whatsapp_templates")
      .upsert(
        { user_id: userId, template_type: type, content, is_active: true },
        { onConflict: "user_id,template_type" },
      );
    setSaving(null);
    if (error) toast.error("Opslaan mislukt: " + error.message);
    else toast.success("Template opgeslagen");
  };

  const reset = (type: WhatsAppTemplateType) => {
    setTemplates((p) => ({ ...p, [type]: { ...p[type], content: DEFAULT_WHATSAPP_TEMPLATES[type] } }));
    persist(type, DEFAULT_WHATSAPP_TEMPLATES[type]);
  };

  const sendTest = async (type: WhatsAppTemplateType) => {
    if (!userId) return;
    if (!testPhone) { toast.error("Vul een testnummer in (E.164, bv. +31612345678)"); return; }
    setSendingTest(type);
    try {
      const message = renderTemplate(templates[type].content, SAMPLE_VARS);
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: { user_id: userId, to: testPhone, message, kind: "test", test: true },
      });
      if (error) throw error;
      if ((data as any)?.success) toast.success("Testbericht verstuurd");
      else toast.error("Verzenden mislukt: " + ((data as any)?.error || "onbekend"));
    } catch (e: any) {
      toast.error(e.message || "Fout bij verzenden");
    } finally {
      setSendingTest(null);
    }
  };

  if (loading) {
    return <div className="glass-card p-6"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  return (
    <div className="glass-card p-6 space-y-5 opacity-0 animate-fade-in-up">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">WhatsApp templates</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Beschikbare variabelen: <code>{`{{customer_name}}`}</code>, <code>{`{{salon_name}}`}</code>,{" "}
        <code>{`{{appointment_date}}`}</code>, <code>{`{{appointment_time}}`}</code>,{" "}
        <code>{`{{services}}`}</code>, <code>{`{{reschedule_link}}`}</code>, <code>{`{{review_link}}`}</code>.
      </p>

      <div className="flex gap-2 items-center">
        <input
          className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm"
          placeholder="Testnummer (bv. +31612345678)"
          value={testPhone}
          onChange={(e) => setTestPhone(e.target.value)}
        />
      </div>

      <div className="space-y-4">
        {TYPES.map((type) => {
          const t = templates[type];
          const sample = renderTemplate(t.content, SAMPLE_VARS);
          return (
            <div key={type} className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{TEMPLATE_LABELS[type]}</h3>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setPreviewOpen(previewOpen === type ? null : type)}>
                    <Eye className="w-4 h-4" /> {previewOpen === type ? "Verberg" : "Voorbeeld"}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => reset(type)}>
                    <RotateCcw className="w-4 h-4" /> Reset
                  </Button>
                  <Button variant="outline" size="sm" disabled={sendingTest === type || !testPhone} onClick={() => sendTest(type)}>
                    {sendingTest === type ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Test
                  </Button>
                </div>
              </div>
              <textarea
                className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm min-h-[140px] font-mono"
                value={t.content}
                onChange={(e) => setTemplates((p) => ({ ...p, [type]: { ...p[type], content: e.target.value } }))}
                onBlur={() => persist(type, t.content)}
              />
              {previewOpen === type && (
                <div className="p-3 rounded-lg bg-secondary/50 text-xs whitespace-pre-wrap">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Voorbeeld</p>
                  {sample}
                </div>
              )}
              {saving === type && <p className="text-[11px] text-muted-foreground">Opslaan...</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
