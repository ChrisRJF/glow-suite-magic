import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useGiftCards, useCustomers } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import { Gift, Plus, CreditCard, CheckCircle2, Clock, XCircle, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "GS-";
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Trash2 } from "lucide-react";

export default function CadeaubonnenPage() {
  const { data: giftCards, refetch } = useGiftCards();
  const { data: customers } = useCustomers();
  const { insert, update, remove } = useCrud("gift_cards");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDeleteCard = async (id: string) => {
    if (await remove(id)) { toast.success("Cadeaubon verwijderd"); refetch(); }
  };

  const [showCreate, setShowCreate] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [form, setForm] = useState({ amount: "50", customer_id: "", customer_name: "", sold_via: "salon" });

  const handleCreate = async () => {
    const amount = Number(form.amount);
    if (amount <= 0) { toast.error("Vul een geldig bedrag in"); return; }
    const code = generateCode();
    await insert({
      code,
      initial_amount: amount,
      remaining_amount: amount,
      customer_id: form.customer_id || null,
      customer_name: form.customer_name,
      sold_via: form.sold_via,
      status: "actief",
    });
    toast.success(`Cadeaubon ${code} aangemaakt — ${formatEuro(amount)}`);
    setShowCreate(false);
    setForm({ amount: "50", customer_id: "", customer_name: "", sold_via: "salon" });
    refetch();
  };

  const handleRedeem = async () => {
    const card = giftCards.find((g: any) => g.code === redeemCode.toUpperCase().trim());
    if (!card) { toast.error("Ongeldige code"); return; }
    const c = card as any;
    if (c.status !== "actief") { toast.error("Deze bon is niet meer geldig"); return; }
    const amount = Number(redeemAmount);
    if (amount <= 0 || amount > Number(c.remaining_amount)) {
      toast.error(`Maximaal inwisselbaar: ${formatEuro(Number(c.remaining_amount))}`);
      return;
    }
    const newRemaining = Number(c.remaining_amount) - amount;
    await update(c.id, {
      remaining_amount: newRemaining,
      status: newRemaining <= 0 ? "gebruikt" : "actief",
    });
    toast.success(`${formatEuro(amount)} ingewisseld van bon ${c.code}`);
    setShowRedeem(false);
    setRedeemCode("");
    setRedeemAmount("");
    refetch();
  };

  const totalSold = giftCards.reduce((s, g: any) => s + Number(g.initial_amount || 0), 0);
  const totalRemaining = giftCards.filter((g: any) => g.status === "actief").reduce((s, g: any) => s + Number(g.remaining_amount || 0), 0);
  const activeCount = giftCards.filter((g: any) => g.status === "actief").length;

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; class: string }> = {
      actief: { label: "Actief", class: "bg-success/15 text-success" },
      gebruikt: { label: "Gebruikt", class: "bg-muted text-muted-foreground" },
      verlopen: { label: "Verlopen", class: "bg-destructive/15 text-destructive" },
    };
    const info = map[status] || map.actief;
    return <span className={cn("px-2 py-0.5 rounded-lg text-[11px] font-medium", info.class)}>{info.label}</span>;
  };

  return (
    <AppLayout title="Cadeaubonnen" subtitle="Aanmaken, verkopen en inwisselen"
      actions={
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowRedeem(true)}>
            <Search className="w-4 h-4" /> Inwisselen
          </Button>
          <Button variant="gradient" size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-4 h-4" /> Nieuwe bon
          </Button>
        </div>
      }>

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><Gift className="w-5 h-5 text-primary" /> Nieuwe cadeaubon</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Bedrag (€) *</label>
                <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                <div className="flex gap-2 mt-2">
                  {[25, 50, 75, 100, 150].map(v => (
                    <button key={v} onClick={() => setForm({ ...form, amount: String(v) })}
                      className={cn("px-3 py-1.5 rounded-lg text-xs font-medium transition-all",
                        form.amount === String(v) ? "bg-primary/15 text-primary" : "bg-secondary/50 text-muted-foreground hover:text-foreground")}>
                      {formatEuro(v)}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Klant (optioneel)</label>
                <select value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="">Geen klant koppelen</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Naam ontvanger</label>
                <input value={form.customer_name} onChange={e => setForm({ ...form, customer_name: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" placeholder="bijv. Jan Janssen" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Verkocht via</label>
                <select value={form.sold_via} onChange={e => setForm({ ...form, sold_via: e.target.value })}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value="salon">In salon</option>
                  <option value="online">Online</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={handleCreate}>Aanmaken</Button>
            </div>
          </div>
        </div>
      )}

      {/* Redeem modal */}
      {showRedeem && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowRedeem(false)}>
          <div className="glass-card p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2"><CreditCard className="w-5 h-5 text-primary" /> Cadeaubon inwisselen</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Code *</label>
                <input value={redeemCode} onChange={e => setRedeemCode(e.target.value.toUpperCase())}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-primary/30"
                  placeholder="GS-XXXXXXXX" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Bedrag inwisselen (€) *</label>
                <input type="number" value={redeemAmount} onChange={e => setRedeemAmount(e.target.value)}
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" className="flex-1" onClick={() => setShowRedeem(false)}>Annuleren</Button>
              <Button variant="gradient" className="flex-1" onClick={handleRedeem}>Inwisselen</Button>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="glass-card p-4">
            <p className="text-2xl font-bold">{activeCount}</p>
            <p className="text-xs text-muted-foreground">Actieve bonnen</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-2xl font-bold text-primary">{formatEuro(totalSold)}</p>
            <p className="text-xs text-muted-foreground">Totaal verkocht</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-2xl font-bold text-warning">{formatEuro(totalRemaining)}</p>
            <p className="text-xs text-muted-foreground">Openstaand saldo</p>
          </div>
        </div>

        {/* Gift cards list */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Gift className="w-4 h-4 text-primary" /> Alle cadeaubonnen
          </h3>
          <div className="space-y-2">
            {giftCards.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nog geen cadeaubonnen</p>
            ) : giftCards.map((g: any) => (
              <div key={g.id} className="flex items-center gap-3 p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
                <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Gift className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-mono font-semibold tracking-wider">{g.code}</p>
                  <p className="text-xs text-muted-foreground">
                    {g.customer_name || "Anoniem"} · {g.sold_via === "online" ? "Online" : "In salon"}
                    {" · "}{new Date(g.created_at).toLocaleDateString("nl-NL", { day: "numeric", month: "short" })}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold tabular-nums">{formatEuro(Number(g.remaining_amount))} <span className="text-muted-foreground font-normal">/ {formatEuro(Number(g.initial_amount))}</span></p>
                  {statusBadge(g.status)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}