import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Send, Loader2, Play, Info } from "lucide-react";
import { toast } from "sonner";
import { useDemoMode } from "@/hooks/useDemoMode";
import { simulateDemoAction } from "@/lib/demoMode";

type WaSettings = {
  id?: string;
  user_id: string;
  enabled: boolean;
  from_number: string | null;
  send_booking_confirmation: boolean;
  send_reminders: boolean;
  send_review_request: boolean;
  reminder_hours_before: number;
  monthly_included_messages: number;
  overage_enabled: boolean;
};

type LogRow = {
  id: string;
  to_number: string;
  message: string;
  status: string;
  error: string | null;
  kind: string;
  created_at: string;
  meta?: any;
};

type Usage = {
  month: string;
  sent_count: number;
  failed_count: number;
  billable_count: number;
  included_limit: number;
  overage_count: number;
};

const SANDBOX_FROM = "whatsapp:+14155238886";
const IS_DEV = import.meta.env.DEV;

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Map technical errors to salon-friendly Dutch messages
function friendlyError(error: string | null | undefined): string {
  if (!error) return "Onbekende fout";
  const e = error.toLowerCase();
  if (/sandbox|not.*joined|join.*code|63007|21608|63015/.test(e)) {
    return "Bericht kon nog niet worden afgeleverd. Probeer het later opnieuw of neem contact op met support.";
  }
  if (/invalid.*number|not.*valid|21211/.test(e)) return "Telefoonnummer is niet geldig.";
  if (/rate.limit|too many/.test(e)) return "Even rustig — te veel berichten in korte tijd.";
  if (/unverified|not.*verified/.test(e)) return "Ontvanger heeft WhatsApp nog niet bevestigd.";
  return "Bericht kon niet worden afgeleverd.";
}

export function WhatsAppConnectionCard() {
  const { demoMode } = useDemoMode();
  const [userId, setUserId] = useState<string | null>(null);
  const [settings, setSettings] = useState<WaSettings | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testPhone, setTestPhone] = useState("");
  const [sending, setSending] = useState(false);
  const [runningScheduler, setRunningScheduler] = useState(false);
  const [lastRun, setLastRun] = useState<{ started_at: string; finished_at: string | null; sent: number; checked: number } | null>(null);
  const [lastTestResult, setLastTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const refreshLogs = async (uid: string) => {
    const { data: l } = await supabase
      .from("whatsapp_logs")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(20);
    setLogs((l as LogRow[]) || []);
  };

  const refreshUsage = async (uid: string) => {
    const { data } = await supabase
      .from("whatsapp_usage_monthly" as any)
      .select("month, sent_count, failed_count, billable_count, included_limit, overage_count")
      .eq("user_id", uid)
      .eq("month", currentMonth())
      .maybeSingle();
    setUsage(data as any);
  };

  const refreshLastRun = async () => {
    const { data } = await supabase
      .from("whatsapp_scheduler_runs")
      .select("started_at, finished_at, sent, checked")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) setLastRun(data as any);
  };

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

      const merged: WaSettings = s ? {
        user_id: auth.user.id,
        enabled: (s as any).enabled ?? false,
        from_number: (s as any).from_number ?? null,
        send_booking_confirmation: (s as any).send_booking_confirmation ?? true,
        send_reminders: (s as any).send_reminders ?? true,
        send_review_request: (s as any).send_review_request ?? false,
        reminder_hours_before: (s as any).reminder_hours_before ?? 24,
        monthly_included_messages: (s as any).monthly_included_messages ?? 300,
        overage_enabled: (s as any).overage_enabled ?? true,
      } : {
        user_id: auth.user.id,
        enabled: false,
        from_number: null,
        send_booking_confirmation: true,
        send_reminders: true,
        send_review_request: false,
        reminder_hours_before: 24,
        monthly_included_messages: 300,
        overage_enabled: true,
      };
      setSettings(merged);

      await Promise.all([refreshLogs(auth.user.id), refreshUsage(auth.user.id), refreshLastRun()]);
      setLoading(false);
    })();
  }, []);

  const persist = async (next: WaSettings) => {
    setSettings(next);
    setSaving(true);
    const { error } = await supabase
      .from("whatsapp_settings")
      .upsert({
        user_id: next.user_id,
        enabled: next.enabled,
        send_booking_confirmation: next.send_booking_confirmation,
        send_reminders: next.send_reminders,
        send_review_request: next.send_review_request,
        reminder_hours_before: next.reminder_hours_before,
      } as any, { onConflict: "user_id" });
    setSaving(false);
    if (error) toast.error("Opslaan mislukt: " + error.message);
  };

  const sendTest = async () => {
    if (!userId || !testPhone) { toast.error("Vul een telefoonnummer in"); return; }
    setSending(true);
    setLastTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          user_id: userId,
          to: testPhone,
          message: "Test bericht vanuit GlowSuite ✅ — je WhatsApp werkt.",
          kind: "test",
          test: true,
        },
      });
      if (error) {
        const ctx: any = (error as any).context;
        let parsed: any = null;
        try { parsed = ctx ? await ctx.json() : null; } catch { /* ignore */ }
        const msg = friendlyError(parsed?.error || error.message);
        setLastTestResult({ ok: false, message: msg });
        toast.error(msg);
      } else if ((data as any)?.success) {
        setLastTestResult({ ok: true, message: "Testbericht verstuurd ✅" });
        toast.success("Testbericht verstuurd");
      } else {
        const d = data as any;
        const msg = friendlyError(d?.error);
        setLastTestResult({ ok: false, message: msg });
        toast.error(msg);
      }
      await Promise.all([refreshLogs(userId), refreshUsage(userId)]);
    } catch (e: any) {
      const msg = friendlyError(e.message);
      setLastTestResult({ ok: false, message: msg });
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  const runSchedulerNow = async () => {
    if (!userId) return;
    setRunningScheduler(true);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-reminder-scheduler", { body: {} });
      if (error) throw error;
      const d = data as any;
      if (d?.success) {
        toast.success(`Herinneringen verstuurd: ${d.sent ?? 0}`);
      } else {
        toast.error("Kon herinneringen niet versturen");
      }
      await Promise.all([refreshLogs(userId), refreshUsage(userId), refreshLastRun()]);
    } catch (e: any) {
      toast.error("Kon herinneringen niet versturen");
    } finally {
      setRunningScheduler(false);
    }
  };

  if (loading || !settings) {
    return <div className="glass-card p-6"><Loader2 className="w-4 h-4 animate-spin" /></div>;
  }

  const connected = settings.enabled;
  const usedFrom = settings.from_number || SANDBOX_FROM;
  const isSandbox = usedFrom === SANDBOX_FROM;
  const lastSent = logs.find(l => l.status === "sent");
  const lastFailed = logs.find(l => l.status === "failed");

  const used = usage?.billable_count ?? 0;
  const limit = settings.monthly_included_messages || 300;
  const overage = Math.max(0, used - limit);
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));

  return (
    <div className="glass-card p-4 sm:p-6 space-y-5 opacity-0 animate-fade-in-up max-w-full overflow-x-hidden">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">WhatsApp</h2>
          <div className="flex items-center gap-2 mt-1 text-sm">
            {connected ? (
              <><CheckCircle2 className="w-4 h-4 text-success" /><span className="text-success">Ingeschakeld</span></>
            ) : (
              <><AlertCircle className="w-4 h-4 text-warning" /><span className="text-warning">Uitgeschakeld</span></>
            )}
          </div>
        </div>
        <Switch
          checked={settings.enabled}
          onCheckedChange={(v) => persist({ ...settings, enabled: v })}
        />
      </div>

      <div className="p-3 rounded-xl bg-primary/5 border border-primary/10 text-xs text-muted-foreground flex gap-2">
        <Info className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
        <p>
          <strong className="text-foreground">WhatsApp wordt mogelijk gemaakt door GlowSuite.</strong>{" "}
          Je hoeft zelf niets te koppelen — berichten worden automatisch via GlowSuite verstuurd.
        </p>
      </div>

      {/* Dev-only sandbox warning, hidden from salon users */}
      {IS_DEV && isSandbox && (
        <div className="p-2 rounded-lg bg-warning/10 border border-warning/30 text-[11px] text-warning">
          [DEV] Sandbox actief — ontvanger moet eerst "join &lt;code&gt;" sturen.
        </div>
      )}

      {/* Usage */}
      <div className="p-4 rounded-xl bg-secondary/40">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="font-medium">Berichten gebruikt deze maand</span>
          <span className="text-muted-foreground">{used} / {limit}</span>
        </div>
        <div className="h-2 rounded-full bg-secondary overflow-hidden">
          <div
            className={`h-full transition-all ${overage > 0 ? "bg-warning" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {overage > 0 && (
          <p className="text-[11px] text-warning mt-2">
            +{overage} extra berichten. Extra verbruik kan achteraf worden gefactureerd.
          </p>
        )}
      </div>

      <div>
        <label className="text-xs text-muted-foreground flex flex-col gap-1 max-w-xs">
          Reminder tijd (uren vooraf)
          <input
            type="number"
            min={1}
            max={168}
            className="px-3 py-2 rounded-lg bg-background border border-border text-base sm:text-sm h-11"
            value={settings.reminder_hours_before}
            onChange={(e) => setSettings({ ...settings, reminder_hours_before: Number(e.target.value) })}
            onBlur={() => persist(settings)}
          />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 gap-3">
          <span className="text-sm font-medium">Boekingsbevestiging versturen</span>
          <Switch checked={settings.send_booking_confirmation} onCheckedChange={(v) => persist({ ...settings, send_booking_confirmation: v })} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 gap-3">
          <span className="text-sm font-medium">Herinneringen versturen</span>
          <Switch checked={settings.send_reminders} onCheckedChange={(v) => persist({ ...settings, send_reminders: v })} />
        </div>
        <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/50 gap-3">
          <span className="text-sm font-medium">Reviewverzoek na bezoek</span>
          <Switch checked={settings.send_review_request} onCheckedChange={(v) => persist({ ...settings, send_review_request: v })} />
        </div>
      </div>

      {/* Status (salon-friendly) */}
      <div className="border-t border-border pt-4 space-y-1">
        <p className="text-sm font-medium mb-2">Status</p>
        <Checkline ok={true} text="WhatsApp klaar voor gebruik" />
        {lastSent && (
          <Checkline ok={true} text={`Laatste verzonden: ${new Date(lastSent.created_at).toLocaleString("nl-NL")}`} />
        )}
        {!lastSent && (
          <Checkline ok={false} warn text="Nog geen berichten verstuurd" />
        )}
        {lastFailed && (
          <Checkline ok={false} text={`Laatste fout: ${friendlyError(lastFailed.error)}`} />
        )}
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium mb-2">Testbericht</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            className="flex-1 px-3 py-2 rounded-lg bg-background border border-border text-base sm:text-sm h-11"
            placeholder="+31612345678"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
          />
          <Button onClick={sendTest} disabled={sending || !testPhone} variant="gradient" size="sm" className="h-11 sm:h-9">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Test
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Gebruik internationaal formaat (bv. +31612345678).
        </p>
        {lastTestResult && (
          <div className={`mt-2 p-2 rounded-lg text-xs ${lastTestResult.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
            {lastTestResult.message}
          </div>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-medium">Automatische herinneringen</p>
            <p className="text-[11px] text-muted-foreground">Worden automatisch verstuurd door GlowSuite.</p>
            {lastRun && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Laatste check: {new Date(lastRun.started_at).toLocaleString("nl-NL")}
                {lastRun.finished_at ? ` · ${lastRun.sent} verzonden` : " · loopt..."}
              </p>
            )}
          </div>
          <Button onClick={runSchedulerNow} disabled={runningScheduler} variant="outline" size="sm" className="h-11 sm:h-9">
            {runningScheduler ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Nu draaien
          </Button>
        </div>
      </div>

      <div className="border-t border-border pt-4">
        <p className="text-sm font-medium mb-2">Recente activiteit</p>
        {logs.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nog geen berichten verstuurd.</p>
        ) : (
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {logs.map((l) => (
              <div key={l.id} className="p-2 rounded-lg bg-secondary/40 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium truncate">{l.to_number.replace(/^whatsapp:/, "")}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] ${l.status === "sent" ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>
                    {l.status === "sent" ? "verzonden" : "mislukt"}
                  </span>
                </div>
                <p className="text-muted-foreground line-clamp-2 mt-1 break-words">{l.message}</p>
                {l.error && <p className="text-destructive mt-1">{friendlyError(l.error)}</p>}
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

function Checkline({ ok, text, warn }: { ok: boolean; text: string; warn?: boolean }) {
  const cls = ok ? "text-success" : warn ? "text-warning" : "text-destructive";
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <div className="flex items-start gap-2 text-xs">
      <Icon className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${cls}`} />
      <span className="text-muted-foreground">{text}</span>
    </div>
  );
}
