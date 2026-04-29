import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
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

export type WhatsAppTemplatesCardProps = {
  /** Active map controlled from parent (automations card). If omitted, internal state used. */
  activeMap?: Partial<Record<WhatsAppTemplateType, boolean>>;
  onActiveChange?: (type: WhatsAppTemplateType, active: boolean) => void;
};

export function WhatsAppTemplatesCard({ activeMap, onActiveChange }: WhatsAppTemplatesCardProps = {}) {
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

  const isActive = (type: WhatsAppTemplateType) =>
    activeMap && type in activeMap ? !!activeMap[type] : templates[type].is_active;

  const persist = async (type: WhatsAppTemplateType, patch: Partial<TemplateRow>) => {
    if (!userId) return;
    setSaving(type);
    const current = templates[type];
    const merged = {
      user_id: userId,
      template_type: type,
      content: patch.content ?? current.content,
      is_active: patch.is_active ?? current.is_active,
    };
    const { error } = await supabase
      .from("whatsapp_templates")
      .upsert(merged, { onConflict: "user_id,template_type" });
    setSaving(null);
    if (error) toast.error("Opslaan mislukt: " + error.message);
    else toast.success("Template opgeslagen");
  };

  const reset = (type: WhatsAppTemplateType) => {
    setTemplates((p) => ({ ...p, [type]: { ...p[type], content: DEFAULT_WHATSAPP_TEMPLATES[type] } }));
    persist(type, { content: DEFAULT_WHATSAPP_TEMPLATES[type] });
  };

  const toggleActive = (type: WhatsAppTemplateType, next: boolean) => {
    setTemplates((p) => ({ ...p, [type]: { ...p[type], is_active: next } }));
    onActiveChange?.(type, next);
    persist(type, { is_active: next });
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

  const minHeightFor = (type: WhatsAppTemplateType) =>
    type === "booking_confirmation" ? "min-h-[160px]" : "min-h-[120px]";

  return (
    <div className="glass-card p-4 sm:p-6 space-y-5 opacity-0 animate-fade-in-up w-full min-w-0 max-w-full overflow-hidden">
      <div className="flex items-center gap-2">
        <MessageSquare className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">WhatsApp templates</h2>
      </div>
      <p className="text-xs text-muted-foreground break-words">
        Beschikbare variabelen: <code className="break-all">{`{{customer_name}}`}</code>,{" "}
        <code className="break-all">{`{{salon_name}}`}</code>,{" "}
        <code className="break-all">{`{{appointment_date}}`}</code>,{" "}
        <code className="break-all">{`{{appointment_time}}`}</code>,{" "}
        <code className="break-all">{`{{services}}`}</code>,{" "}
        <code className="break-all">{`{{reschedule_link}}`}</code>,{" "}
        <code className="break-all">{`{{review_link}}`}</code>.
      </p>

      <Input
        type="tel"
        inputMode="tel"
        className="w-full"
        placeholder="Testnummer (bv. +31612345678)"
        value={testPhone}
        onChange={(e) => setTestPhone(e.target.value)}
      />

      <div className="space-y-4">
        {TYPES.map((type) => {
          const t = templates[type];
          const active = isActive(type);
          const sample = renderTemplate(t.content, SAMPLE_VARS);
          return (
            <div key={type} className="rounded-xl border border-border p-3 sm:p-4 space-y-3 w-full min-w-0">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 min-w-0">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-medium truncate">{TEMPLATE_LABELS[type]}</h3>
                  <p className={`text-[11px] mt-0.5 ${active ? "text-success" : "text-muted-foreground"}`}>
                    {active ? "Actief" : "Uitgeschakeld"}
                  </p>
                </div>
                <Switch checked={active} onCheckedChange={(v) => toggleActive(type, v)} />
              </div>

              {/* Editor */}
              <Textarea
                value={t.content}
                onChange={(e) => setTemplates((p) => ({ ...p, [type]: { ...p[type], content: e.target.value } }))}
                onBlur={() => persist(type, { content: t.content })}
                className={`w-full font-sans text-base sm:text-sm ${minHeightFor(type)} resize-y whitespace-pre-wrap break-words`}
                style={{ fontFamily: "inherit" }}
              />

              {/* Actions: stacked on mobile, inline on desktop */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full min-h-[44px] sm:min-h-0"
                  onClick={() => setPreviewOpen(previewOpen === type ? null : type)}
                >
                  <Eye className="w-4 h-4" /> {previewOpen === type ? "Verberg" : "Voorbeeld"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full min-h-[44px] sm:min-h-0"
                  onClick={() => reset(type)}
                >
                  <RotateCcw className="w-4 h-4" /> Reset
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full min-h-[44px] sm:min-h-0"
                  disabled={sendingTest === type || !testPhone}
                  onClick={() => sendTest(type)}
                >
                  {sendingTest === type ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Test
                </Button>
              </div>

              {previewOpen === type && (
                <div className="p-3 rounded-lg bg-secondary/50 text-xs whitespace-pre-wrap break-words">
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
