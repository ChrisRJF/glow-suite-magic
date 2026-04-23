import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { useProducts, useSettings, useWebshopOrders } from "@/hooks/useSupabaseData";
import { useCrud } from "@/hooks/useCrud";
import { formatEuro } from "@/lib/data";
import { ShoppingCart, Eye, EyeOff, Package, Globe, Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useMemo, useState } from "react";

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export default function WebshopPage() {
  const { data: rawProducts, refetch } = useProducts();
  const { data: rawSettings, refetch: refetchSettings } = useSettings();
  const { data: orders, loading: ordersLoading, refetch: refetchOrders } = useWebshopOrders();
  const products = rawProducts as any[];
  const settings = rawSettings[0] as any | undefined;
  const { update } = useCrud("products");
  const settingsCrud = useCrud("settings");
  const [shopLoading, setShopLoading] = useState(false);
  const [productLoadingId, setProductLoadingId] = useState<string | null>(null);

  const onlineProducts = products.filter((p) => p.online_visible && p.is_active);
  const totalValue = onlineProducts.reduce((s, p) => s + Number(p.price || 0) * Number(p.stock || 0), 0);
  const webshopEnabled = Boolean(settings?.webshop_enabled);
  const shopSlug = settings?.public_slug || slugify(settings?.salon_name || "mijn-salon");
  const shopUrl = `${window.location.origin}/shop/${shopSlug}`;
  const embedCode = `<div data-glowsuite-shop></div>\n<script src="${window.location.origin}/shop-widget.js" data-salon="${shopSlug}" async></script>`;

  const paidOrders = useMemo(() => orders.filter((order: any) => order.payment_status === "paid"), [orders]);

  const toggleWebshop = async (id: string, current: boolean) => {
    setProductLoadingId(id);
    try {
      await update(id, { online_visible: !current });
      toast.success(current ? "Product verborgen in shop" : "Product zichtbaar in shop");
      await refetch();
    } finally {
      setProductLoadingId(null);
    }
  };

  const toggleShopActive = async () => {
    if (!settings?.id) { toast.error("Sla eerst je saloninstellingen op."); return; }
    setShopLoading(true);
    try {
      if (await settingsCrud.update(settings.id, { webshop_enabled: !webshopEnabled })) {
        toast.success(!webshopEnabled ? "Shopwidget actief" : "Shopwidget uitgeschakeld");
        await refetchSettings();
      }
    } finally {
      setShopLoading(false);
    }
  };

  const copyEmbed = async () => {
    await navigator.clipboard.writeText(embedCode);
    toast.success("Embedcode gekopieerd");
  };

  return (
    <AppLayout title="Webshop" subtitle="Eenvoudige online productverkoop">
      <div className="grid gap-6">
        <div className="glass-card p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", webshopEnabled ? "bg-success/15" : "bg-primary/15")}>
              <Globe className={cn("w-5 h-5", webshopEnabled ? "text-success" : "text-primary")} />
            </div>
            <div>
              <p className="text-sm font-semibold">Shopwidget {webshopEnabled ? "actief" : "nog niet live"}</p>
              <p className="text-xs text-muted-foreground">Alleen online zichtbare producten verschijnen in de widget</p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => window.open(shopUrl, "_blank")}><ExternalLink className="w-4 h-4" /> Preview</Button>
            <Button variant={webshopEnabled ? "outline" : "gradient"} size="sm" onClick={toggleShopActive} disabled={shopLoading}>
              {shopLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{webshopEnabled ? "Shop uitzetten" : "Shop activeren"}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="glass-card p-4">
            <p className="text-2xl font-bold">{onlineProducts.length}</p>
            <p className="text-xs text-muted-foreground">Producten online</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-2xl font-bold text-primary">{formatEuro(totalValue)}</p>
            <p className="text-xs text-muted-foreground">Online voorraadwaarde</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-2xl font-bold text-success">{paidOrders.length}</p>
            <p className="text-xs text-muted-foreground">Betaalde orders</p>
          </div>
          <div className="glass-card p-4">
            <p className="text-2xl font-bold">{products.reduce((s, p) => s + (p.stock || 0), 0)}</p>
            <p className="text-xs text-muted-foreground">Totale voorraad</p>
          </div>
        </div>

        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Copy className="w-4 h-4 text-primary" /> Embedcode</h3>
          <div className="rounded-xl bg-secondary/40 border border-border p-3 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap">{embedCode}</div>
          <Button variant="outline" size="sm" className="mt-3" onClick={copyEmbed}><Copy className="w-4 h-4" /> Kopieer code</Button>
        </div>

        <div className="glass-card p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2"><Package className="w-4 h-4 text-primary" /> Online producten beheren</h3>
          <div className="space-y-2">
            {products.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Voeg eerst producten toe via Producten</p>
            ) : products.map((p) => (
              <div key={p.id} className="flex items-center gap-3 p-4 rounded-xl bg-secondary/30 hover:bg-secondary/50 transition-colors">
                <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0", p.online_visible ? "bg-success/15" : "bg-muted")}>
                  {p.online_visible ? <Eye className="w-4 h-4 text-success" /> : <EyeOff className="w-4 h-4 text-muted-foreground" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground">{p.category || "Geen categorie"} · Voorraad: {p.stock || 0}</p>
                </div>
                <div className="text-right flex-shrink-0 mr-3">
                  <p className="text-sm font-semibold">{formatEuro(p.price)}</p>
                </div>
                <Button variant={p.online_visible ? "outline" : "gradient"} size="sm" onClick={() => toggleWebshop(p.id, Boolean(p.online_visible))} disabled={productLoadingId === p.id}>
                  {productLoadingId === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : p.online_visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  {p.online_visible ? "Verbergen" : "Tonen"}
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-sm font-semibold flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-primary" /> Orders</h3>
            <Button variant="outline" size="sm" onClick={refetchOrders}>Vernieuwen</Button>
          </div>
          <div className="space-y-2">
            {ordersLoading ? (
              <p className="text-sm text-muted-foreground text-center py-6">Orders laden...</p>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">Nog geen webshoporders</p>
            ) : orders.slice(0, 20).map((order: any) => (
              <div key={order.id} className="p-4 rounded-xl bg-secondary/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{order.order_number}</p>
                  <p className="text-xs text-muted-foreground">{order.customer_name || order.customer_email || "Onbekende klant"} · {new Date(order.created_at).toLocaleDateString("nl-NL")}</p>
                </div>
                <div className="text-left sm:text-right">
                  <p className="text-sm font-semibold">{formatEuro(order.total_amount || 0)}</p>
                  <p className={cn("text-xs font-medium", order.payment_status === "paid" ? "text-success" : order.payment_status === "failed" ? "text-destructive" : "text-warning")}>{order.payment_status === "paid" ? "Betaald" : order.payment_status === "failed" ? "Mislukt" : "Open"}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
