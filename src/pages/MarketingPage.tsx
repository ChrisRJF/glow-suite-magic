import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useCampaigns, useCustomers, useDiscounts } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { MessageCircle, Mail, TrendingUp, Users, Zap, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function MarketingPage() {
  const { data: campaigns, refetch: refetchCampaigns } = useCampaigns();
  const { data: customers } = useCustomers();
  const { data: discounts, refetch: refetchDiscounts } = useDiscounts();
  const { insert: insertCampaign } = useCrud("campaigns");
  const { insert: insertDiscount, update: updateDiscount } = useCrud("discounts");
  const [sending, setSending] = useState<string | null>(null);
  const [showCampaign, setShowCampaign] = useState(false);
  const [campaignForm, setCampaignForm] = useState({ title: '', type: 'whatsapp', message: '', audience: '' });

  const quickActions = [
    { label: "Last-minute deal versturen", icon: Zap, desc: "Stuur korting voor lege plekken vandaag" },
    { label: "Heractiveer inactieve klanten", icon: Users, desc: "Bereik klanten die 30+ dagen niet zijn geweest" },
    { label: "VIP campagne", icon: TrendingUp, desc: "Exclusieve aanbieding voor je beste klanten" },
  ];

  const segments = [
    { name: "VIP klanten", count: customers.filter(c => (Number(c.total_spent) || 0) > 500).length, color: "text-primary" },
    { name: "Inactief (30+ dagen)", count: customers.filter(c => !c.updated_at || (Date.now() - new Date(c.updated_at).getTime()) > 30 * 86400000).length, color: "text-warning" },
    { name: "Nieuwe klanten", count: customers.filter(c => (Date.now() - new Date(c.created_at).getTime()) < 30 * 86400000).length, color: "text-success" },
  ];

  const handleAction = async (label: string) => {
    setSending(label);
    await insertCampaign({ title: label, type: 'whatsapp', status: 'concept', sent_count: 0, message: `Campagnevoorstel: ${label}` });
    setTimeout(() => {
      setSending(null);
      toast.success(`"${label}" is klaargezet als concept.`);
      refetchCampaigns();
    }, 1200);
  };

  const handleCreateCampaign = async () => {
    if (!campaignForm.title.trim()) { toast.error("Titel is verplicht"); return; }
    await insertCampaign({ ...campaignForm, status: 'concept', sent_count: 0 });
    toast.success("Campagne aangemaakt");
    setShowCampaign(false);
    setCampaignForm({ title: '', type: 'whatsapp', message: '', audience: '' });
    refetchCampaigns();
  };

  return (
    <AppLayout title="Marketing" subtitle="Campagnes, segmenten en automatiseringen">
      {showCampaign && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCampaign(false)}>
          <div className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">Nieuwe campagne</h3>
            <div className="space-y-3">
              <div><label className="text-xs text-muted-foreground">Titel *</label><input value={campaignForm.title} onChange={e => setCampaignForm({...campaignForm, title: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" /></div>
              <div><label className="text-xs text-muted-foreground">Type</label>
                <select value={campaignForm.type} onChange={e => setCampaignForm({...campaignForm, type: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="whatsapp">WhatsApp</option><option value="email">E-mail</option>
                </select>
              </div>
              <div><label className="text-xs text-muted-foreground">Bericht</label><textarea value={campaignForm.message} onChange={e => setCampaignForm({...campaignForm, message: e.target.value})} className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[80px]" /></div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setShowCampaign(false)}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={handleCreateCampaign}>Aanmaken</Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {quickActions.map((a) => (
            <button key={a.label} onClick={() => handleAction(a.label)} disabled={sending === a.label}
              className="glass-card p-5 text-left hover:border-primary/30 transition-all group">
              <a.icon className="w-5 h-5 text-primary mb-2 group-hover:scale-110 transition-transform" />
              <p className="text-sm font-semibold">{a.label}</p>
              <p className="text-xs text-muted-foreground mt-1">{a.desc}</p>
              {sending === a.label && <p className="text-xs text-primary mt-2 animate-pulse">Bezig met versturen...</p>}
            </button>
          ))}
        </div>

        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4">Klantsegmenten</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {segments.map((s) => (
              <div key={s.name} className="p-3 rounded-xl bg-secondary/40 text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.name}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">Campagnes</h3>
            <Button size="sm" onClick={() => setShowCampaign(true)}><Plus className="w-3 h-3 mr-1" /> Nieuwe campagne</Button>
          </div>
          <div className="space-y-3">
            {campaigns.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">Nog geen campagnes</p> :
            campaigns.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-4 rounded-xl bg-secondary/30">
                <div className="flex items-center gap-3">
                  {c.type === 'whatsapp' ? <MessageCircle className="w-4 h-4 text-success" /> : <Mail className="w-4 h-4 text-primary" />}
                  <div>
                    <p className="text-sm font-medium">{c.title}</p>
                    <p className="text-xs text-muted-foreground">{c.sent_count || 0} verstuurd · {c.type}</p>
                  </div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full ${c.status === 'verzonden' ? 'bg-success/20 text-success' : c.status === 'actief' ? 'bg-primary/20 text-primary' : 'bg-secondary text-muted-foreground'}`}>{c.status === 'concept' ? 'Concept' : c.status === 'verzonden' ? 'Verzonden' : c.status || 'Niet ingesteld'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
