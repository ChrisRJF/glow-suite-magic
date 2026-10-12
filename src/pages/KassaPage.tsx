import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useProducts, useServices, useCustomers } from "@/hooks/useSupabaseData";
import { useDemoMode } from "@/hooks/useDemoMode";
import { useAuth } from "@/contexts/AuthContext";
import { formatEuro } from "@/lib/data";
import { ShoppingBag, Plus, Minus, Check, Wallet, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { TerminalPaymentDialog } from "@/components/TerminalPaymentDialog";
import { KassaServerPay } from "@/components/KassaServerPay";
import { loadSaved as loadServerSaved } from "@/lib/kassaServer";
import { supabase } from "@/integrations/supabase/client";
import { useCallback } from "react";
import { beginOrResume, loadPending, settlePending, type KassaCart, type KassaPending } from "@/lib/kassaPending";

const safeStorage = () => { try { return window.localStorage; } catch { return null; } };
const newKey = () => crypto.randomUUID();

export default function KassaPage() {
  const { data: products } = useProducts();
  const { data: services } = useServices();
  const { data: customers } = useCustomers();
  const { demoMode } = useDemoMode();
  const { user } = useAuth();
  const userId = user?.id ?? "";
  const [cart, setCart] = useState<KassaCart>({});
  const [paid, setPaid] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [pending, setPending] = useState<KassaPending | null>(null);

  // After reload: restore the open terminal payment and its cart, locked.
  useEffect(() => {
    if (!userId) return;
    const p = loadPending(safeStorage(), userId);
    if (p) { setPending(p); setCart(p.cart); setSelectedCustomer(p.customerId); }
  }, [userId]);

  // Server Kassa only when the platform switched it on for this salon (kassa_orders_enabled). Otherwise unchanged.
  const [serverKassa, setServerKassa] = useState(false);
  const [serverLocked, setServerLocked] = useState(false);
  useEffect(() => {
    if (!userId) return;
    (supabase.rpc as any)("kassa_payment_status").then(({ data }: any) => setServerKassa(data?.ok === true && data?.enabled === true));
  }, [userId]);
  const onServerLock = useCallback((l: boolean) => setServerLocked(l), []);
  const serverLines = Object.values(cart).map((i) => ({ type: (i.type === "product" ? "product" : "service") as "service" | "product", item_id: i.itemId, qty: i.qty }));

  const locked = !!pending || paid || serverLocked;

  const allItems = [
    ...services.filter(s => s.is_active).map(s => ({ id: s.id, name: s.name, price: s.price, type: 'service' })),
    ...products.filter(p => p.is_active).map(p => ({ id: p.id, name: p.name, price: p.price, type: 'product' })),
  ];

  const addItem = (item: typeof allItems[0]) =>
    setCart(prev => {
      const key = item.id;
      if (prev[key]) return { ...prev, [key]: { ...prev[key], qty: prev[key].qty + 1 } };
      return { ...prev, [key]: { name: item.name, price: item.price, qty: 1, type: item.type, itemId: item.id } };
    });

  const removeItem = (key: string) =>
    setCart(prev => {
      const n = { ...prev };
      if (n[key].qty > 1) n[key] = { ...n[key], qty: n[key].qty - 1 };
      else delete n[key];
      return n;
    });

  const total = Object.values(cart).reduce((s, i) => s + i.price * i.qty, 0);

  const openTerminal = () => {
    const r = beginOrResume(safeStorage(), userId, { cart, customerId: selectedCustomer, demo: demoMode }, newKey);
    if (r.ok === false) {
      toast.error(r.reason === "other_pending" ? "Er staat nog een andere pinbetaling open. Controleer eerst die status." : "Betaling kan niet veilig worden voorbereid. Probeer het opnieuw.");
      return;
    }
    setPending(r.pending);
    setTerminalOpen(true);
  };

  const onFinal = (status: string) => {
    if (!pending) return;
    settlePending(safeStorage(), userId, pending.key, status);
    if (status === "paid") {
      setPaid(true);
      toast.success(`Betaling van ${formatEuro(pending.amountCents / 100)} bevestigd door het pinapparaat.`);
      setPending(null);
      setTimeout(() => { setCart({}); setPaid(false); setSelectedCustomer(""); }, 2000);
    } else {
      setPending(null);
    }
  };

  const onRetryKey = () => {
    const r = beginOrResume(safeStorage(), userId, { cart, customerId: selectedCustomer, demo: demoMode }, newKey);
    if (r.ok === false) return null;
    setPending(r.pending);
    return r.pending.key;
  };

  return (
    <AppLayout title="Kassa" subtitle="Snel afrekenen met GlowPay">
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-primary" /> Producten & behandelingen
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {allItems.length === 0 ? <p className="col-span-2 text-sm text-muted-foreground text-center py-4">Voeg eerst producten of behandelingen toe</p> :
            allItems.map((p) => (
              <button key={p.id} disabled={locked} onClick={() => addItem(p)}
                className="p-4 rounded-xl bg-secondary/40 hover:bg-secondary/60 transition-colors text-left">
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-primary mt-1">{formatEuro(p.price)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{p.type === 'service' ? 'Behandeling' : 'Product'}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="glass-card p-6 flex flex-col">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary" /> Bestelling
          </h3>

          {/* Customer selector */}
          <div className="mb-4">
            <label className="text-xs text-muted-foreground">Klant (optioneel)</label>
            <select value={selectedCustomer} disabled={locked} onChange={e => setSelectedCustomer(e.target.value)}
              className="w-full mt-1 px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
              <option value="">Geen klant geselecteerd</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="flex-1 space-y-2">
            {Object.keys(cart).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Klik op een product om toe te voegen</p>
            ) : Object.entries(cart).map(([key, item]) => (
              <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30">
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{formatEuro(item.price)} × {item.qty}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button disabled={locked} onClick={() => removeItem(key)} className="p-1 rounded-lg hover:bg-secondary"><Minus className="w-3 h-3" /></button>
                  <span className="text-sm font-medium w-6 text-center">{item.qty}</span>
                  <button disabled={locked} onClick={() => addItem(allItems.find(i => i.id === key)!)} className="p-1 rounded-lg hover:bg-secondary"><Plus className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
          </div>
          {(Object.keys(cart).length > 0 || (serverKassa && !!loadServerSaved(safeStorage(), userId)?.paymentId)) && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-2">Betaalmethode</p>
                <div className="p-2.5 rounded-xl text-sm flex items-center gap-2 bg-primary/15 border border-primary/30 text-primary font-medium">
                  <Smartphone className="w-4 h-4" /> Pinapparaat
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Contant, online en andere betaalmethoden zijn in de Kassa tijdelijk niet beschikbaar. Een betaling telt pas als het pinapparaat hem bevestigt.</p>
              </div>
              <div className="flex justify-between mb-4">
                <span className="text-sm font-semibold">Totaal</span>
                <span className="text-lg font-bold">{formatEuro(total)}</span>
              </div>
              {(paid || pending) && (
                <div className="mb-3 rounded-xl bg-secondary/40 p-3 text-xs text-muted-foreground">
                  {paid
                    ? <span className="font-medium text-primary">Betaald. Bevestigd door het pinapparaat.</span>
                    : <>Er staat een pinbetaling open voor deze bestelling. Open hem opnieuw om de status te zien; er wordt geen tweede betaling gestart.</>}
                </div>
              )}
              {serverKassa ? (
                <KassaServerPay userId={userId} demo={demoMode} customerId={selectedCustomer || null} lines={serverLines}
                  onLockChange={onServerLock} onPaid={() => setTimeout(() => { setCart({}); setSelectedCustomer(""); }, 2000)} />
              ) : (<>
              <Button type="button" className="w-full" size="lg" onClick={openTerminal} disabled={paid || total <= 0 || terminalOpen || !userId}>
                {paid ? <><Check className="w-4 h-4 mr-2" /> Betaald</> : <><Smartphone className="w-4 h-4 mr-2" /> {pending ? "Openstaande pinbetaling bekijken" : "Betaal op pinapparaat"}</>}
              </Button>
              <TerminalPaymentDialog
                open={terminalOpen}
                onOpenChange={setTerminalOpen}
                amountCents={pending?.amountCents ?? Math.round(total * 100)}
                description={`Kassa ${Object.values(cart).map(i => i.name).join(", ").slice(0, 80)}`}
                customerId={selectedCustomer || null}
                source="checkout"
                idempotencyKey={pending?.key}
                onFinal={onFinal}
                onRetryKey={onRetryKey}
              />
              </>)}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
