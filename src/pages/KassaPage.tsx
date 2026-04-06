import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useProducts, useServices, useCustomers } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import { ShoppingBag, Plus, Minus, CreditCard, Check, Wallet } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const paymentMethods = [
  { id: "pin", label: "GlowPay Pin", icon: "📱" },
  { id: "contant", label: "Contant", icon: "💵" },
  { id: "ideal", label: "GlowPay Online", icon: "🏦" },
  { id: "anders", label: "Anders", icon: "💰" },
];

export default function KassaPage() {
  const { data: products } = useProducts();
  const { data: services } = useServices();
  const { data: customers } = useCustomers();
  const { insert: insertCheckout } = useCrud("checkout_items");
  const { insert: insertPayment } = useCrud("payments");
  const { update: updateProduct } = useCrud("products");
  const { update: updateCustomer } = useCrud("customers");
  const [cart, setCart] = useState<Record<string, { name: string; price: number; qty: number; type: string; itemId: string }>>({});
  const [paid, setPaid] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState("pin");
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");

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

  const handlePay = async () => {
    setPaid(true);
    for (const [key, item] of Object.entries(cart)) {
      await insertCheckout({ item_type: item.type, item_id: item.itemId, title: item.name, price: item.price, quantity: item.qty, customer_id: selectedCustomer || null });
      if (item.type === 'product') {
        const prod = products.find(p => p.id === item.itemId);
        if (prod) await updateProduct(prod.id, { stock: Math.max(0, (prod.stock || 0) - item.qty) });
      }
    }
    // Create GlowPay payment record
    await insertPayment({
      amount: total,
      currency: "EUR",
      payment_type: "full",
      status: "paid",
      method: selectedMethod,
      payment_method: selectedMethod,
      provider: "glowpay",
      is_demo: true,
      customer_id: selectedCustomer || null,
      paid_at: new Date().toISOString(),
    });
    // Update customer total_spent
    if (selectedCustomer) {
      const cust = customers.find(c => c.id === selectedCustomer);
      if (cust) await updateCustomer(cust.id, { total_spent: (Number(cust.total_spent) || 0) + total });
    }
    toast.success(`GlowPay betaling van ${formatEuro(total)} voltooid!`);
    setTimeout(() => { setCart({}); setPaid(false); setSelectedCustomer(""); }, 2000);
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
              <button key={p.id} onClick={() => addItem(p)}
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
            <select value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)}
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
                  <button onClick={() => removeItem(key)} className="p-1 rounded-lg hover:bg-secondary"><Minus className="w-3 h-3" /></button>
                  <span className="text-sm font-medium w-6 text-center">{item.qty}</span>
                  <button onClick={() => addItem(allItems.find(i => i.id === key)!)} className="p-1 rounded-lg hover:bg-secondary"><Plus className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
          </div>
          {Object.keys(cart).length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              {/* Payment method */}
              <div className="mb-4">
                <p className="text-xs text-muted-foreground mb-2">Betaalmethode</p>
                <div className="grid grid-cols-2 gap-2">
                  {paymentMethods.map(m => (
                    <button key={m.id} onClick={() => setSelectedMethod(m.id)}
                      className={cn("p-2.5 rounded-xl text-left transition-all text-sm flex items-center gap-2",
                        selectedMethod === m.id ? "bg-primary/15 border border-primary/30 text-primary font-medium" : "bg-secondary/40 border border-transparent hover:bg-secondary/60")}>
                      <span>{m.icon}</span> {m.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-between mb-4">
                <span className="text-sm font-semibold">Totaal</span>
                <span className="text-lg font-bold">{formatEuro(total)}</span>
              </div>
              <Button className="w-full" size="lg" onClick={handlePay} disabled={paid}>
                {paid ? <><Check className="w-4 h-4 mr-2" /> Betaald!</> : <><CreditCard className="w-4 h-4 mr-2" /> Afrekenen via GlowPay</>}
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
