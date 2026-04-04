import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { formatEuro } from "@/lib/data";
import { ShoppingBag, Plus, Minus, CreditCard, Check } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const products = [
  { id: "1", name: "Knippen dames", price: 45 },
  { id: "2", name: "Kleuren", price: 85 },
  { id: "3", name: "Föhnen", price: 25 },
  { id: "4", name: "Gezichtsbehandeling", price: 65 },
  { id: "5", name: "Shampoo (product)", price: 18 },
  { id: "6", name: "Haarmasker (product)", price: 24 },
];

export default function KassaPage() {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [paid, setPaid] = useState(false);

  const addItem = (id: string) => setCart((p) => ({ ...p, [id]: (p[id] || 0) + 1 }));
  const removeItem = (id: string) =>
    setCart((p) => {
      const n = { ...p };
      if (n[id] > 1) n[id]--;
      else delete n[id];
      return n;
    });

  const total = Object.entries(cart).reduce((s, [id, qty]) => {
    const product = products.find((p) => p.id === id);
    return s + (product?.price || 0) * qty;
  }, 0);

  const handlePay = () => {
    setPaid(true);
    toast.success(`Betaling van ${formatEuro(total)} ontvangen!`);
    setTimeout(() => {
      setCart({});
      setPaid(false);
    }, 2000);
  };

  return (
    <AppLayout title="Kassa" subtitle="Snel afrekenen">
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Products */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-primary" /> Producten & behandelingen
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {products.map((p) => (
              <button
                key={p.id}
                onClick={() => addItem(p.id)}
                className="p-4 rounded-xl bg-secondary/40 hover:bg-secondary/60 transition-colors text-left"
              >
                <p className="text-sm font-medium">{p.name}</p>
                <p className="text-xs text-primary mt-1">{formatEuro(p.price)}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Cart */}
        <div className="glass-card p-6 flex flex-col">
          <h3 className="text-sm font-semibold mb-4">Huidige bestelling</h3>
          <div className="flex-1 space-y-2">
            {Object.entries(cart).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Klik op een product om toe te voegen</p>
            ) : (
              Object.entries(cart).map(([id, qty]) => {
                const product = products.find((p) => p.id === id)!;
                return (
                  <div key={id} className="flex items-center justify-between p-3 rounded-xl bg-secondary/30">
                    <div>
                      <p className="text-sm font-medium">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{formatEuro(product.price)} × {qty}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => removeItem(id)} className="p-1 rounded-lg hover:bg-secondary">
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-sm font-medium w-6 text-center">{qty}</span>
                      <button onClick={() => addItem(id)} className="p-1 rounded-lg hover:bg-secondary">
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {Object.keys(cart).length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex justify-between mb-4">
                <span className="text-sm font-semibold">Totaal</span>
                <span className="text-lg font-bold">{formatEuro(total)}</span>
              </div>
              <Button className="w-full" size="lg" onClick={handlePay} disabled={paid}>
                {paid ? (
                  <><Check className="w-4 h-4 mr-2" /> Betaald!</>
                ) : (
                  <><CreditCard className="w-4 h-4 mr-2" /> Afrekenen</>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
}
