import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, Loader2, ChevronDown, CheckCircle2, Lightbulb, MinusCircle, Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AI_CATEGORY_LABELS, AI_MODE_LABELS,
  type AICategory, type AIMode,
  useAIModes,
} from "@/lib/aiModes";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "sonner";

const MODES: AIMode[] = ["suggestions", "autopilot", "off"];
const SHORT_LABEL: Record<AIMode, string> = {
  suggestions: "Suggesties",
  autopilot: "Auto",
  off: "Uit",
};

function Segmented({
  value, onChange, disabled, size = "md",
}: { value: AIMode; onChange: (m: AIMode) => void; disabled?: boolean; size?: "sm" | "md" }) {
  return (
    <div
      role="radiogroup"
      className={cn(
        "inline-flex items-center rounded-full bg-muted/70 p-1 ring-1 ring-border/40",
        size === "md" ? "w-full sm:w-auto gap-1" : "gap-0.5",
      )}
    >
      {MODES.map((m) => {
        const active = value === m;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(m)}
            className={cn(
              "relative rounded-full whitespace-nowrap font-medium leading-none",
              "transition-all duration-200 ease-out",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              "active:scale-[0.97]",
              size === "md"
                ? "flex-1 sm:flex-none px-4 py-2 text-[13px] min-h-[36px]"
                : "px-3 py-1.5 text-[11px] min-h-[30px]",
              active
                ? "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08),0_1px_3px_rgba(123,97,255,0.18)]"
                : "bg-transparent text-muted-foreground hover:text-foreground",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            {SHORT_LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}

interface RecentItem {
  id: string;
  ts: string;
  text: string;
  kind: "auto" | "suggestion" | "skipped";
}

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "zojuist";
  if (m < 60) return `${m} min geleden`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} u geleden`;
  const d = Math.round(h / 24);
  return `${d} d geleden`;
}

export function AIModesCard() {
  const { user } = useAuth();
  const { modes, loading, saving, setGlobal, setCategory } = useAIModes();
  const { demoMode } = useDemoMode();
  const { isAdmin } = useUserRole();
  const isMobile = useIsMobile();
  const cats = Object.keys(AI_CATEGORY_LABELS) as AICategory[];

  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [pendingAuto, setPendingAuto] = useState<null | { scope: "global" } | { scope: "category"; category: AICategory }>(null);

  const requestGlobal = (m: AIMode) => {
    if (m === "autopilot" && modes.global !== "autopilot") {
      setPendingAuto({ scope: "global" });
      return;
    }
    setGlobal(m);
  };
  const requestCategory = (c: AICategory, m: AIMode) => {
    if (m === "autopilot" && modes.categories[c] !== "autopilot") {
      setPendingAuto({ scope: "category", category: c });
      return;
    }
    setCategory(c, m);
  };
  const confirmAuto = async () => {
    if (!pendingAuto) return;
    if (pendingAuto.scope === "global") await setGlobal("autopilot");
    else await setCategory(pendingAuto.category, "autopilot");
    setPendingAuto(null);
    toast.success("GlowSuite AI staat nu op Auto");
  };
  const open = pendingAuto !== null;
  const onOpenChange = (o: boolean) => { if (!o) setPendingAuto(null); };

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("automation_logs")
        .select("id, status, event_type, message, metadata, created_at")
        .eq("user_id", user.id)
        .eq("is_demo", demoMode)
        .order("created_at", { ascending: false })
        .limit(3);
      if (cancelled) return;
      const items: RecentItem[] = ((data as any[]) || []).map((r) => {
        const status = (r.status || "").toLowerCase();
        const skipped = status === "skipped" || (r.metadata?.skipped_reason);
        const suggestion = status === "suggestion" || status === "suggested" || status === "advice";
        const kind: RecentItem["kind"] = skipped ? "skipped" : suggestion ? "suggestion" : "auto";
        const label =
          kind === "auto" ? "Automatisch uitgevoerd"
          : kind === "suggestion" ? "Suggestie klaar"
          : "Overgeslagen door AI-modus";
        return {
          id: r.id,
          ts: r.created_at,
          text: `${label} · ${friendlyEvent(r.event_type)}`,
          kind,
        };
      });
      setRecent(items);
    })();
    return () => { cancelled = true; };
  }, [user, demoMode]);

  return (
    <Card className="animate-fade-in border-primary/20">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="inline-flex w-6 h-6 rounded-md bg-gradient-to-br from-primary to-accent items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
              </span>
              AI gedrag
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              Kies hoeveel GlowSuite automatisch mag doen.
            </CardDescription>
          </div>
          {saving && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span className="text-xs text-muted-foreground">Algemene modus</span>
          <Segmented value={modes.global} onChange={requestGlobal} disabled={loading} />
        </div>

        {demoMode && (
          <p className="text-[11px] text-muted-foreground">
            Demo staat op <strong>Suggesties</strong> zodat je rustig kunt verkennen.
          </p>
        )}

        <Collapsible>
          <CollapsibleTrigger
            className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5 transition-transform group-data-[state=open]:rotate-180" />
            Per onderdeel instellen
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3 space-y-1.5">
            {cats.map((c) => (
              <div
                key={c}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card px-3 py-2"
              >
                <span className="text-xs font-medium truncate">{AI_CATEGORY_LABELS[c]}</span>
                <Segmented
                  size="sm"
                  value={modes.categories[c]}
                  onChange={(m) => setCategory(c, m)}
                  disabled={loading || modes.global === "off"}
                />
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>

        {recent.length > 0 && (
          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center gap-1.5 mb-2">
              <Activity className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[11px] text-muted-foreground uppercase tracking-wide">
                Recente AI-acties
              </span>
            </div>
            <ul className="space-y-1.5">
              {recent.map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-xs">
                  {r.kind === "auto" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />}
                  {r.kind === "suggestion" && <Lightbulb className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />}
                  {r.kind === "skipped" && <MinusCircle className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />}
                  <span className="flex-1 truncate text-foreground/80">{r.text}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">{relTime(r.ts)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {isAdmin && (
          <Collapsible>
            <CollapsibleTrigger className="group flex items-center gap-1.5 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors pt-1">
              <ChevronDown className="w-3 h-3 transition-transform group-data-[state=open]:rotate-180" />
              Geavanceerd
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <pre className="text-[10px] bg-muted/50 rounded-md p-2 overflow-auto max-h-40 text-muted-foreground">
{JSON.stringify(modes, null, 2)}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

function friendlyEvent(t: string): string {
  const s = (t || "").toLowerCase();
  if (s.includes("reminder")) return "Herinnering verstuurd";
  if (s.includes("review")) return "Reviewverzoek";
  if (s.includes("no_show") || s.includes("noshow")) return "No-show actie";
  if (s.includes("payment")) return "Betaalactie";
  if (s.includes("membership")) return "Membership actie";
  if (s.includes("rebook") || s.includes("herboek") || s.includes("winback")) return "Heractivatie";
  if (s.includes("revenue") || s.includes("empty_slot") || s.includes("lege_plek")) return "Lege plek gevuld";
  if (s.includes("campaign") || s.includes("campagne")) return "Campagne";
  return t || "AI actie";
}
