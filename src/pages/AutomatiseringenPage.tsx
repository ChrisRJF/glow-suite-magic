import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { DEFAULT_WHATSAPP_TEMPLATES, type WhatsAppTemplateType } from "@/lib/whatsappTemplates";
import {
  AlertCircle,
  Bell,
  CalendarCheck,
  Cake,
  CheckCircle2,
  Clock,
  Gift,
  MessageCircle,
  Sparkles,
  UserX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

type Status = "live" | "soon" | "off";

type AutoDef = {
  key: string;
  title: string;
  description: string;
  trigger: string;
  action: string;
  templateLabel: string;
  templateType?: WhatsAppTemplateType;
  /** Which whatsapp_settings boolean column controls master enable */
  settingsFlag?: "send_booking_confirmation" | "send_reminders" | "send_review_request";
  /** Which whatsapp_logs.kind to count for "last sent" */
  logKind?: "confirmation" | "reminder" | "review";
  status: Status;
  comingSoonReason?: string;
  icon: any;
};

const AUTOMATIONS: AutoDef[] = [
  {
    key: "booking_confirmation",
    title: "Boekingsbevestiging",
    description: "Klant ontvangt direct na boeking of betaling een WhatsApp-bevestiging.",
    trigger: "Nieuwe afspraak aangemaakt",
    action: "WhatsApp bevestiging versturen",
    templateLabel: "Boekingsbevestiging",
    templateType: "booking_confirmation",
    settingsFlag: "send_booking_confirmation",
    logKind: "confirmation",
    status: "live",
    icon: CheckCircle2,
  },
  {
    key: "reminder",
    title: "Afspraakherinnering",
    description: "Automatische herinnering ruim voor de afspraak (standaard 24 uur vooraf).",
    trigger: "X uur voor de afspraak",
    action: "WhatsApp herinnering versturen",
    templateLabel: "Herinnering",
    templateType: "reminder",
    settingsFlag: "send_reminders",
    logKind: "reminder",
    status: "live",
    icon: Clock,
  },
  {
    key: "review",
    title: "Na-afspraak bedankje",
    description: "Bedank-bericht met reviewverzoek nadat de afspraak is afgerond.",
    trigger: "Status afspraak: voltooid (of eindtijd voorbij)",
    action: "WhatsApp bedankje + review-link",
    templateLabel: "Review verzoek",
    templateType: "review",
    settingsFlag: "send_review_request",
    logKind: "review",
    status: "live",
    icon: Sparkles,
  },
  {
    key: "no_show",
    title: "No-show follow-up",
    description: "Bericht naar klanten die niet zijn verschenen, om opnieuw in te plannen.",
    trigger: "Status afspraak: no-show (binnen 24 uur)",
    action: "WhatsApp follow-up versturen",
    templateLabel: "No-show",
    templateType: "no_show",
    settingsFlag: "send_no_show_followup",
    logKind: "no_show",
    status: "live",
    icon: UserX,
  },
  {
    key: "reactivation",
    title: "Heractivering",
    description: "Win-back bericht voor klanten zonder afspraak in 6 weken.",
    trigger: "Klant inactief 6+ weken",
    action: "WhatsApp heractiveringsbericht",
    templateLabel: "Heractivering",
    status: "soon",
    comingSoonReason: "Komt binnenkort — vereist aparte scheduler.",
    icon: Gift,
  },
  {
    key: "birthday",
    title: "Verjaardagskorting",
    description: "Felicitatie en kortingscode op de verjaardag van de klant.",
    trigger: "Verjaardag van klant",
    action: "WhatsApp verjaardagsbericht",
    templateLabel: "Verjaardag",
    status: "soon",
    comingSoonReason: "Verjaardagsveld op klant ontbreekt nog.",
    icon: Cake,
  },
];

type WaSettings = {
  enabled: boolean;
  send_booking_confirmation: boolean;
  send_reminders: boolean;
  send_review_request: boolean;
} | null;

export default function AutomatiseringenPage() {
  const { user } = useAuth();
  const { hasAny } = useUserRole();
  const canManage = hasAny("eigenaar", "manager", "admin");

  const [waSettings, setWaSettings] = useState<WaSettings>(null);
  const [tplActive, setTplActive] = useState<Partial<Record<WhatsAppTemplateType, boolean>>>({});
  const [lastSent, setLastSent] = useState<Partial<Record<string, string>>>({});
  const [lastRun, setLastRun] = useState<{ started_at: string; sent: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [waRes, tplRes, logsRes, runsRes] = await Promise.all([
      supabase
        .from("whatsapp_settings")
        .select("enabled, send_booking_confirmation, send_reminders, send_review_request")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("whatsapp_templates")
        .select("template_type, is_active")
        .eq("user_id", user.id),
      supabase
        .from("whatsapp_logs")
        .select("kind, created_at, status")
        .eq("user_id", user.id)
        .eq("status", "sent")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("whatsapp_scheduler_runs")
        .select("started_at, sent")
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    setWaSettings((waRes.data as any) || null);
    const tplMap: Partial<Record<WhatsAppTemplateType, boolean>> = {};
    for (const r of (tplRes.data as any[]) || []) tplMap[r.template_type as WhatsAppTemplateType] = r.is_active;
    setTplActive(tplMap);
    const lastByKind: Record<string, string> = {};
    for (const l of (logsRes.data as any[]) || []) {
      if (!lastByKind[l.kind]) lastByKind[l.kind] = l.created_at;
    }
    setLastSent(lastByKind);
    setLastRun((runsRes.data as any) || null);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const isOn = (def: AutoDef): boolean => {
    if (def.status !== "live") return false;
    if (!waSettings?.enabled) return false;
    const flagOn = def.settingsFlag ? !!waSettings[def.settingsFlag] : true;
    const tplOn = def.templateType ? tplActive[def.templateType] !== false : true;
    return flagOn && tplOn;
  };

  const toggle = async (def: AutoDef, next: boolean) => {
    if (!user || !canManage || def.status !== "live") return;
    setBusy(def.key);
    try {
      // 1) ensure whatsapp_settings row + flag
      if (def.settingsFlag) {
        const patch: any = { [def.settingsFlag]: next };
        const { data: existing } = await supabase
          .from("whatsapp_settings")
          .select("id")
          .eq("user_id", user.id)
          .maybeSingle();
        if (existing) {
          await supabase.from("whatsapp_settings").update(patch).eq("user_id", user.id);
        } else {
          await supabase.from("whatsapp_settings").insert({ user_id: user.id, ...patch });
        }
      }
      // 2) sync template is_active
      if (def.templateType) {
        const { data: tpl } = await supabase
          .from("whatsapp_templates")
          .update({ is_active: next })
          .eq("user_id", user.id)
          .eq("template_type", def.templateType)
          .select("id");
        if (!tpl || tpl.length === 0) {
          await supabase.from("whatsapp_templates").insert({
            user_id: user.id,
            template_type: def.templateType,
            is_active: next,
            content: DEFAULT_WHATSAPP_TEMPLATES[def.templateType],
          });
        }
      }
      toast.success(next ? "Automatisering aangezet" : "Automatisering uitgezet");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Kon niet opslaan");
    } finally {
      setBusy(null);
    }
  };

  const formatRelative = (iso?: string) => {
    if (!iso) return "Nog niet verstuurd";
    const d = new Date(iso);
    const diffMin = Math.round((Date.now() - d.getTime()) / 60000);
    if (diffMin < 1) return "Zojuist";
    if (diffMin < 60) return `${diffMin} min geleden`;
    if (diffMin < 60 * 24) return `${Math.round(diffMin / 60)} uur geleden`;
    return d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  };

  const stats = useMemo(() => {
    const live = AUTOMATIONS.filter((a) => a.status === "live");
    return {
      total: AUTOMATIONS.length,
      liveCount: live.length,
      activeCount: live.filter((a) => isOn(a)).length,
    };
  }, [waSettings, tplActive]);

  return (
    <AppLayout
      title="Automatiseringen"
      subtitle="Slimme WhatsApp-automatiseringen die voor je werken"
    >
      {/* Master state banner */}
      {!loading && !waSettings?.enabled && (
        <Card className="mb-4 border-amber-200 bg-amber-50/50 dark:bg-amber-950/20">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">WhatsApp staat nog uit</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Activeer WhatsApp om automatiseringen te laten lopen.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/whatsapp">Naar WhatsApp</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-4">
        <SummaryTile label="Actief" value={`${stats.activeCount}/${stats.liveCount}`} icon={Bell} />
        <SummaryTile
          label="Laatste boekings­bevestiging"
          value={formatRelative(lastSent.confirmation)}
          icon={CheckCircle2}
        />
        <SummaryTile
          label="Laatste herinnering"
          value={formatRelative(lastSent.reminder)}
          icon={Clock}
        />
        <SummaryTile
          label="Scheduler laatste run"
          value={lastRun?.started_at ? formatRelative(lastRun.started_at) : "—"}
          icon={CalendarCheck}
        />
      </div>

      {/* Automations list */}
      <div className="space-y-3">
        {AUTOMATIONS.map((def) => {
          const on = isOn(def);
          const live = def.status === "live";
          const Icon = def.icon;
          const lastIso = def.logKind ? lastSent[def.logKind] : undefined;
          return (
            <Card
              key={def.key}
              className={cn(
                "overflow-hidden transition-shadow",
                live && on && "ring-1 ring-primary/30",
              )}
            >
              <CardContent className="p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "rounded-xl p-2.5 shrink-0",
                      live && on
                        ? "bg-gradient-to-br from-primary to-accent text-primary-foreground"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-sm sm:text-base">{def.title}</h3>
                          <StatusBadge status={def.status} on={on} />
                        </div>
                        <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                          {def.description}
                        </p>
                      </div>
                      <Switch
                        checked={on}
                        disabled={!live || !canManage || busy === def.key || !waSettings?.enabled}
                        onCheckedChange={(v) => toggle(def, v)}
                      />
                    </div>

                    <dl className="mt-3 grid gap-1.5 text-xs sm:grid-cols-2">
                      <Row label="Trigger" value={def.trigger} />
                      <Row label="Actie" value={def.action} />
                      <Row label="Template" value={def.templateLabel} />
                      <Row
                        label="Laatst verstuurd"
                        value={live ? formatRelative(lastIso) : "—"}
                      />
                    </dl>

                    {!live && def.comingSoonReason && (
                      <p className="mt-3 text-xs text-muted-foreground italic">
                        {def.comingSoonReason}
                      </p>
                    )}

                    {live && def.templateType && (
                      <div className="mt-3">
                        <Button asChild variant="ghost" size="sm" className="h-8 px-2 text-xs">
                          <Link to="/whatsapp">
                            <MessageCircle className="h-3.5 w-3.5 mr-1.5" />
                            Bewerk template
                          </Link>
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppLayout>
  );
}

function StatusBadge({ status, on }: { status: Status; on: boolean }) {
  if (status === "soon") {
    return (
      <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        Binnenkort
      </span>
    );
  }
  if (on) {
    return (
      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
        Live
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      Uitgeschakeld
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="text-muted-foreground min-w-[5.5rem]">{label}</dt>
      <dd className="font-medium text-foreground/90 truncate">{value}</dd>
    </div>
  );
}

function SummaryTile({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-[10px] uppercase tracking-wide">{label}</span>
        </div>
        <div className="mt-1 text-sm font-semibold truncate">{value}</div>
      </CardContent>
    </Card>
  );
}
