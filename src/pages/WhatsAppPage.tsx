import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCampaigns } from "@/hooks/useSupabaseData";
import { MessageCircle, Send, Clock, Sparkles, Users, Zap, Phone, CheckCircle2, Pencil, Copy, Trash2, MoreVertical } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { WhatsAppConnectionCard } from "@/components/WhatsAppConnectionCard";
import { WhatsAppTemplatesCard } from "@/components/WhatsAppTemplatesCard";
import { WhatsAppTemplateType, DEFAULT_WHATSAPP_TEMPLATES } from "@/lib/whatsappTemplates";
import { WhatsAppCampaignEditor, type AudienceType, type CampaignDraft } from "@/components/WhatsAppCampaignEditor";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type AutomationKey = "booking_confirmation" | "reminder" | "review" | "reactivation" | "birthday";

type AutomationDef = {
  key: AutomationKey;
  templateType?: WhatsAppTemplateType; // linked template
  icon: any;
  title: string;
  description: string;
  comingSoon?: boolean;
};

const AUTOMATIONS: AutomationDef[] = [
  { key: "booking_confirmation", templateType: "booking_confirmation", icon: CheckCircle2, title: "Boekingsbevestiging", description: "Direct na boeking of betaling" },
  { key: "reminder", templateType: "reminder", icon: Clock, title: "Afspraakherinnering", description: "Automatisch 24 uur van tevoren" },
  { key: "review", templateType: "review", icon: Sparkles, title: "Na-afspraak bedankje", description: "Automatisch na elke behandeling" },
  { key: "reactivation", icon: Users, title: "Heractivering", description: "Na 4 weken zonder bezoek", comingSoon: true },
  { key: "birthday", icon: Zap, title: "Verjaardagskorting", description: "Automatisch op de verjaardag", comingSoon: true },
];

export default function WhatsAppPage() {
  const { data: campaigns, refetch } = useCampaigns();
  const { insert } = useCrud("campaigns");

  // active map for the three real automations (mirrors whatsapp_templates.is_active)
  const [activeMap, setActiveMap] = useState<Partial<Record<WhatsAppTemplateType, boolean>>>({
    booking_confirmation: true,
    reminder: true,
    review: true,
  });
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      setUserId(auth.user.id);
      const { data } = await supabase
        .from("whatsapp_templates")
        .select("template_type, is_active")
        .eq("user_id", auth.user.id);
      if (data) {
        setActiveMap((prev) => {
          const next = { ...prev };
          for (const r of data as any[]) {
            if (["booking_confirmation", "reminder", "review"].includes(r.template_type)) {
              next[r.template_type as WhatsAppTemplateType] = !!r.is_active;
            }
          }
          return next;
        });
      }
    })();
  }, []);

  const setActive = async (type: WhatsAppTemplateType, next: boolean) => {
    setActiveMap((p) => ({ ...p, [type]: next }));
    if (!userId) return;
    // Try update first (preserves existing content)
    const { data: updated } = await supabase
      .from("whatsapp_templates")
      .update({ is_active: next })
      .eq("user_id", userId)
      .eq("template_type", type)
      .select("id");
    if (!updated || updated.length === 0) {
      // No row yet — insert with default content
      await supabase.from("whatsapp_templates").insert({
        user_id: userId,
        template_type: type,
        is_active: next,
        content: DEFAULT_WHATSAPP_TEMPLATES[type],
      } as any);
    }
  };

  const toggleAutomation = async (a: AutomationDef) => {
    if (a.comingSoon || !a.templateType) {
      toast.info("Deze automatisering wordt later toegevoegd.");
      return;
    }
    const current = !!activeMap[a.templateType];
    await setActive(a.templateType, !current);
    toast.success(current ? `${a.title} uitgeschakeld` : `${a.title} ingeschakeld`);
  };

  const allMessages = campaigns
    .filter((c) => c.type === "whatsapp" || c.type === "sms")
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const handleNewCampaign = async () => {
    await insert({ title: "Nieuwe WhatsApp campagne", type: "whatsapp", status: "concept", message: "Hoi {naam}! We hebben een special voor je 💜" });
    toast.success("Campagne aangemaakt");
    refetch();
  };

  const statusColor = (s: string | null) => {
    if (s === "geboekt" || s === "verzonden" || s === "afgeleverd") return "bg-success/15 text-success";
    if (s === "geklikt" || s === "geopend") return "bg-primary/15 text-primary";
    if (s === "mislukt") return "bg-destructive/15 text-destructive";
    return "bg-warning/15 text-warning";
  };

  return (
    <AppLayout title="WhatsApp & SMS" subtitle="Automatische berichten, campagnes en logs.">
      <div className="w-full max-w-full overflow-x-hidden space-y-6">
        {/* Top: Connection + Automations */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full min-w-0">
          <div className="min-w-0 w-full">
            <WhatsAppConnectionCard />
          </div>

          <div className="glass-card p-4 sm:p-6 opacity-0 animate-fade-in-up min-w-0 w-full" style={{ animationDelay: "100ms" }}>
            <div className="flex items-center gap-2 mb-5">
              <MessageCircle className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Automatiseringen</h2>
            </div>
            <div className="space-y-3">
              {AUTOMATIONS.map((a) => {
                const active = !a.comingSoon && a.templateType ? !!activeMap[a.templateType] : false;
                return (
                  <div key={a.key} className="flex items-center gap-3 sm:gap-4 p-3 sm:p-4 rounded-xl bg-secondary/50 min-w-0">
                    <div className="w-10 h-10 shrink-0 rounded-xl bg-secondary flex items-center justify-center">
                      <a.icon className="w-5 h-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium truncate">{a.title}</p>
                        {a.comingSoon && (
                          <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                            Binnenkort
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {a.comingSoon ? "Deze automatisering wordt later toegevoegd." : a.description}
                      </p>
                    </div>
                    <Switch
                      checked={active}
                      disabled={a.comingSoon}
                      onCheckedChange={() => toggleAutomation(a)}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Templates + Log */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full min-w-0">
          <div className="min-w-0 w-full">
            <WhatsAppTemplatesCard
              activeMap={activeMap}
              onActiveChange={(type, active) => setActiveMap((p) => ({ ...p, [type]: active }))}
            />
          </div>

          <div className="glass-card p-4 sm:p-6 opacity-0 animate-fade-in-up min-w-0 w-full" style={{ animationDelay: "200ms" }}>
            <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
              <h2 className="text-lg font-semibold">Berichtenlog</h2>
              <Button variant="gradient" size="sm" onClick={handleNewCampaign}>
                <Send className="w-4 h-4" /> Nieuwe Campagne
              </Button>
            </div>
            <div className="space-y-3 max-h-[520px] overflow-y-auto">
              {allMessages.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nog geen berichten verstuurd</p>
              ) : (
                allMessages.map((c) => (
                  <div key={c.id} className="p-3 sm:p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors duration-200 min-w-0">
                    <div className="flex items-center justify-between mb-2 gap-2 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {c.type === "sms" ? (
                          <Phone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        ) : (
                          <MessageCircle className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                        )}
                        <h3 className="text-sm font-semibold truncate">{c.title}</h3>
                      </div>
                      <span className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex-shrink-0 ${statusColor(c.status)}`}>
                        {c.status || "concept"}
                      </span>
                    </div>
                    {c.message && <p className="text-xs text-muted-foreground mb-2 leading-relaxed line-clamp-2 break-words">{c.message}</p>}
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {c.audience && <span className="truncate">→ {c.audience}</span>}
                      <span className="ml-auto flex-shrink-0">
                        {new Date(c.created_at).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
