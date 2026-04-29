import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useCampaigns } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { MessageCircle, Send, Clock, Users, Sparkles, Zap, MessageSquare, Phone } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { getTemplates, saveTemplates, MessageTemplate } from "@/lib/messaging";
import { WhatsAppConnectionCard } from "@/components/WhatsAppConnectionCard";
import { WhatsAppTemplatesCard } from "@/components/WhatsAppTemplatesCard";

export default function WhatsAppPage() {
  const { data: campaigns, refetch } = useCampaigns();
  const { insert } = useCrud("campaigns");
  const [automations, setAutomations] = useState([
    { icon: Clock, title: 'Afspraakherinnering', description: 'Automatisch 24 uur van tevoren', active: true },
    { icon: Sparkles, title: 'Na-afspraak bedankje', description: 'Automatisch na elke behandeling', active: true },
    { icon: Users, title: 'Heractivering', description: 'Na 4 weken zonder bezoek', active: false },
    { icon: Zap, title: 'Verjaardagskorting', description: 'Automatisch op de verjaardag', active: false },
  ]);
  const [templates, setTemplates] = useState<MessageTemplate[]>(getTemplates());
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => { setTemplates(getTemplates()); }, []);

  // Show all messaging activity (whatsapp + sms) — sorted newest first
  const allMessages = campaigns
    .filter(c => c.type === 'whatsapp' || c.type === 'sms')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const handleNewCampaign = async () => {
    await insert({ title: 'Nieuwe WhatsApp campagne', type: 'whatsapp', status: 'concept', message: 'Hoi {naam}! We hebben een special voor je 💜' });
    toast.success("Campagne aangemaakt");
    refetch();
  };

  const toggleAutomation = (idx: number) => {
    setAutomations(prev => prev.map((a, i) => i === idx ? { ...a, active: !a.active } : a));
    toast.success(automations[idx].active ? `${automations[idx].title} uitgeschakeld` : `${automations[idx].title} ingeschakeld`);
  };

  const updateTemplate = (id: string, body: string) => {
    const next = templates.map(t => t.id === id ? { ...t, body } : t);
    setTemplates(next);
    saveTemplates(next);
  };

  const statusColor = (s: string | null) => {
    if (s === 'geboekt' || s === 'verzonden' || s === 'afgeleverd') return 'bg-success/15 text-success';
    if (s === 'geklikt' || s === 'geopend') return 'bg-primary/15 text-primary';
    if (s === 'mislukt') return 'bg-destructive/15 text-destructive';
    return 'bg-warning/15 text-warning';
  };

  return (
    <AppLayout title="WhatsApp & SMS" subtitle="Automatische berichten, campagnes en logs.">
      <div className="mb-6">
        <WhatsAppConnectionCard />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold">Berichtenlog</h2>
            <Button variant="gradient" size="sm" onClick={handleNewCampaign}><Send className="w-4 h-4" /> Nieuwe Campagne</Button>
          </div>
          <div className="space-y-3 max-h-[520px] overflow-y-auto">
            {allMessages.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">Nog geen berichten verstuurd</p> :
            allMessages.map((c) => (
              <div key={c.id} className="p-4 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors duration-200">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {c.type === 'sms' ? <Phone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <MessageCircle className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                    <h3 className="text-sm font-semibold truncate">{c.title}</h3>
                  </div>
                  <span className={`px-2.5 py-1 rounded-lg text-[11px] font-medium flex-shrink-0 ${statusColor(c.status)}`}>{c.status || 'concept'}</span>
                </div>
                {c.message && <p className="text-xs text-muted-foreground mb-2 leading-relaxed line-clamp-2">{c.message}</p>}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  {c.audience && <span className="truncate">→ {c.audience}</span>}
                  <span className="ml-auto flex-shrink-0">{new Date(c.created_at).toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '200ms' }}>
            <div className="flex items-center gap-2 mb-5">
              <MessageCircle className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Automatiseringen</h2>
            </div>
            <div className="space-y-3">
              {automations.map((a, i) => (
                <div key={i} className="flex items-center gap-4 p-4 rounded-xl bg-secondary/50">
                  <div className="w-10 h-10 rounded-xl bg-secondary flex items-center justify-center"><a.icon className="w-5 h-5 text-muted-foreground" /></div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium">{a.title}</p><p className="text-xs text-muted-foreground">{a.description}</p></div>
                  <Switch checked={a.active} onCheckedChange={() => toggleAutomation(i)} />
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card p-6 opacity-0 animate-fade-in-up" style={{ animationDelay: '300ms' }}>
            <div className="flex items-center gap-2 mb-5">
              <MessageSquare className="w-5 h-5 text-primary" />
              <h2 className="text-lg font-semibold">Berichttemplates</h2>
            </div>
            <div className="space-y-2">
              {templates.map(t => (
                <div key={t.id} className="p-3 rounded-xl bg-secondary/50">
                  <button onClick={() => setEditId(editId === t.id ? null : t.id)} className="w-full flex items-center justify-between text-left">
                    <span className="text-sm font-medium">{t.label}</span>
                    <span className="text-[10px] uppercase text-muted-foreground">{t.channel}</span>
                  </button>
                  {editId === t.id ? (
                    <textarea
                      className="w-full mt-2 px-3 py-2 rounded-lg bg-background border border-border text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[80px]"
                      value={t.body}
                      onChange={e => updateTemplate(t.id, e.target.value)}
                      onBlur={() => toast.success("Template opgeslagen")}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.body}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-3">Gebruik {`{{naam}}`}, {`{{dienst}}`}, {`{{boeklink}}`}, {`{{betaallink}}`}.</p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
