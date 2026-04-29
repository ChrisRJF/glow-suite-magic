import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Send, Loader2, Play } from "lucide-react";
import { toast } from "sonner";

type WaSettings = {
  id?: string;
  user_id: string;
  enabled: boolean;
  from_number: string;
  send_booking_confirmation: boolean;
  send_reminders: boolean;
  reminder_hours_before: number;
};

type LogRow = {
  id: string;
  to_number: string;
  message: string;
  status: string;
  error: string | null;
  kind: string;
  created_at: string;
};

export function WhatsAppConnectionCard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<WaSettings | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [runningScheduler, setRunningScheduler] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) { setLoading(false); return; }
      setUserId(auth.user.id);

      const { data: s } = await supabase
        .from("whatsapp_settings")
        .select("*")
        .eq("user_id", auth.user.id)
        .maybeSingle();

      if (s) {
        setSettings(s as WaSettings);
      } else {
        const initial: WaSettings = {
          user_id: auth.user.id,
          enabled: false,
          from_number: "whatsapp:+14155238886",
          send_booking_confirmation: true,
          send_reminders: true,
          reminder_hours_before: 24,
        };
        setSettings(initial);
      }

      const { data: l } = await supabase
        .from("whatsapp_logs")
        .select("*")
        .eq("user_id", auth.user.id)
        .order("created_at", { ascending: false })
        .limit(20);
      setLogs((l as LogRow[]) || []);
      setLoading(false);
    })();
  }, []);

  const persist = async (next: WaSettings) => {
    setSettings(next);
    setSaving(true);
    const { error } = await supabase
      .from("whatsapp_settings")
      .upsert({ ...next }, { onConflict: "user_id" });
    setSaving(false);
    if (error) toast.error("Opslaan mislukt: " + error.message);
  };

  const sendTest = async () => {
    if (!userId || !testPhone) { toast.error("Vul een telefoonnummer in"); return; }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          user_id: userId,
          to: testPhone,
          message: "Test bericht vanuit GlowSuite ✅ — je WhatsApp koppeling werkt.",
          kind: "test",
          test: true,
        },
      });
      if (error) throw error;
      if ((data as any)?.success) {
        toast.success("Testbericht verstuurd");
      } else {
        toast.error("Verzenden mislukt: " + ((data as any)?.error || "onbekend"));
      }
      const { data: l } = await supabase
        .from("whatsapp_logs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      setLogs((l as LogRow[]) || []);
    } catch (e: any) {
      toast.error(e.message || "Fout bij verzenden");
    } finally {
      setSending(false);
    }
  };

  const runSchedulerNow = async () => {
    if (!userId) return;
    setRunningScheduler(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-reminder-scheduler", {
        body: {},
      });
      if (error) throw error;
      const d = data as any;
      if (d?.success) {
        toast.success(`Scheduler uitgevoerd — verzonden: ${d.sent ?? 0}, gecheckt: ${d.checked ?? 0}, overgeslagen: ${d.skipped ?? 0}, fouten: ${d.failed ?? 0}`);
      } else {
        toast.error("Scheduler fout: " + (d?.error || "onbekend"));
      }
      const { data: l } = await supabase
        .from("whatsapp_logs")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      setLogs((l as LogRow[]) || []);
    } catch (e: any) {
      toast.error(e.message || "Scheduler fout");
    } finally {
      setRunningScheduler(false);
    }
  };

  if (loading || !settings) {
    return <div className="glass-card p-6"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  const connected = settings.enabled;

  return (
    <div className="glass-card p-6 space-y-5 opacity-0 animate-fade-in-up">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">WhatsApp koppeling</h2>
          <div className="flex items-center gap-2 mt-1 text-sm">
            {connected ? (
              <><CheckCircle2 className="w-4 h-4 text-success" /><span className="text-success">Verbonden via Twilio</span></>
            ) : (
              <><AlertCircle className="w-4 h-4 text-warning" /><span className="text-warning">Nog niet verbonden</span></>
            )}
          </div>
        </div>
        <Switch
          checked={settings.enabled}
          onCheckedChange={(v) => persist({ ...settings, enabled: v })}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Afzendernummer (Twilio WhatsApp)
          <input
            className="px-3 py-2 rounded-lg bg-background border border-border text-sm"
            value={settings.from_number}
            onChange={(e) => setSettings({ ...settings, from_number: e.target.value })}
            onBlur={() => persist(settings)}
            placeholder="whatsapp:+14155238886"
          />
        </label>
        <label className="text-xs text-muted-foreground flex flex-col gap-1">
          Reminder tijd (uren vooraf)
          <input
            type="number"
            min={1}
            max={168}
            className="px-3 py-2 rounded-lg bg-background border border-border text-sm"
            value={settings.reminder_hours_before}
            onChange={(e) => setSettings({ ...settings, reminder_hours_before: Number(e.target.value) })}
            onBlur={() => persist(settings)}
          />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50">
          <span className="text-sm font-medium">Boekingsbevestiging versturen</span>
          <Switch
            checked={settings.send_booking_confirmation}
            onCheckedChange={(v) => persist({ ...settings, send_booking_confirmation: v })}
          />
        </div>
        <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50">
          <span className="text-sm font-medium">Herinneringen versturen</span>
          <Switch
            checked={settings.send_reminders}
            onCheckedChange={(v) => persist({ ...settings, send_reminders: v })}
          />
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium mb-2">Testbericht</p>
        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-sm"
            placeholder="+31612345678"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
          />
          <Button onClick={sendTest} disabled={sending || !testPhone} variant="gradient" size="sm">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Test
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Tip: gebruik je eigen nummer in E.164 formaat (bv. +31612345678).
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium mb-2">Recente WhatsApp activiteit</p>
        {logs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nog geen berichten verstuurd.</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className="p-2 rounded-lg bg-secondary/40 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{l.to_number}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] ${l.status === "sent" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                    {l.status}
                  </span>
                </div>
                <p className="text-muted-foreground line-clamp-2 mt-1">{l.message}</p>
                {l.error && <p className="text-destructive mt-1">{l.error}</p>}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {new Date(l.created_at).toLocaleString("nl-NL")} · {l.kind}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {saving && <p className="text-[11px] text-muted-foreground">Opslaan...</p>}
    </div>
  );
}
