import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useProducts } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import { ShoppingCart, Eye, EyeOff, Package, TrendingUp, Globe } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function WebshopPage() {
  const { data: products, refetch } = useProducts();
  const { update } = useCrud("products");

  const activeProducts = products.filter(p => p.is_active);
  const totalValue = activeProducts.reduce((s, p) => s + p.price * (p.stock || 0), 0);

  const toggleWebshop = (id: string, current: boolean) => {
    update(id, { is_active: !current }).then(() => {
      toast.success(current ? "Product verborgen in webshop" : "Product zichtbaar in webshop");
      refetch();
    });
  };

  return (
    <AppLayout title="Webshop" subtitle="Online productverkoop">
      <div className="grid gap-6">
        {/* Toggle */}
        <div className="glass-card p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center">
              <Globe className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold">Webshop nog niet live</p>
              <p className="text-xs text-muted-foreground">Productzichtbaarheid is voorbereid; online checkout volgt later</p>
            </div>
          </div>
          <button disabled className="px-3 py-1.5 rounded-lg bg-secondary text-xs text-muted-foreground cursor-not-allowed">
            Binnenkort beschikbaar
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div className="glass-card p-4">
            <p className="text-2xl font-bold">{activeProducts.length}</p>
            <p className="text-xs text-muted-foreground">Producten online</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-2xl font-bold text-primary">{formatEuro(totalValue)}</p>
            <p className="text-xs text-muted-foreground">Voorraadwaarde</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-2xl font-bold text-success">{products.reduce((s, p) => s + (p.stock || 0), 0)}</p>
            <p className="text-xs text-muted-foreground">Totale voorraad</p>
          </div>
        </div>

        {/* Products */}
        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Package className="w-4 h-4 text-primary" /> Producten
          </h3>
          <div className="space-y-2">
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Voeg eerst producten toe via Producten</p>
            ) : products.map(p => (
              <div key={p.id} className="flex items-center gap-3 p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0",
                  p.is_active ? "bg-success/15" : "bg-muted")}>
                  {p.is_active ? <Eye className="w-4 h-4 text-success" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.category || "Geen categorie"} · Voorraad: {p.stock || 0}</p>
                </div>
                <div className="text-right flex-shrink-0 mr-3">
                  <p className="text-sm font-semibold">{formatEuro(p.price)}</p>
                </div>
                <Button variant={p.is_active ? "outline" : "gradient"} size="sm" onClick={() => toggleWebshop(p.id, p.is_active ?? true)}>
                  {p.is_active ? <><EyeOff className="w-3.5 h-3.5" /> Verbergen</> : <><Eye className="w-3.5 h-3.5" /> Tonen</>}
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}