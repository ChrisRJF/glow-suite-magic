import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { formatEuro } from "@/lib/data";
import { cn } from "@/lib/utils";
import { PaymentMethodLogo } from "@/components/PaymentMethodLogo";
import { ArrowLeft, CheckCircle2, Loader2, Minus, Plus, ShoppingBag, ShoppingCart, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { toast } from "sonner";

type ShopProduct = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  stock: number;
  image_url?: string | null;
};

type CartItem = ShopProduct & { quantity: number };

type ShopData = {
  salon: {
    slug: string;
    name: string;
    logo_url?: string;
    primary_color?: string;
    secondary_color?: string;
  };
  products: ShopProduct[];
};

const paymentMethods = [
  { id: "ideal", label: "iDEAL | Wero" },
  { id: "bancontact", label: "Bancontact" },
  { id: "creditcard", label: "Creditcard" },
  { id: "applepay", label: "Apple Pay" },
  { id: "paypal", label: "PayPal" },
];

function callPublicShop<T>(body: Record<string, unknown>) {
  return supabase.functions.invoke("public-shop", { body }).then(({ data, error }) => {
    if (error) throw new Error(error.message || "Shop is niet bereikbaar");
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as T;
  });
}

export default function ShopPage() {
  const { salonSlug = "" } = useParams();
  const isEmbed = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("embed") === "1";
  const [shop, setShop] = useState<ShopData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [customer, setCustomer] = useState({ name: "", email: "", phone: "" });
  const [method, setMethod] = useState("ideal");
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [confirmedOrder, setConfirmedOrder] = useState<string | null>(null);

  const loadShop = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await callPublicShop<ShopData>({ action: "get_shop", slug: salonSlug });
      setShop(data);
    } catch (err: any) {
      setError(err.message || "Shop kon niet worden geladen.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShop();
  }, [salonSlug]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const order = params.get("order");
    if (params.get("status") === "payment-return" && order) {
      setConfirmedOrder(order);
      setCart([]);
      setCartOpen(false);
    }
  }, []);

  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
  const itemCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  const addToCart = (product: ShopProduct) => {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        return current.map((item) => item.id === product.id ? { ...item, quantity: Math.min(item.stock, item.quantity + 1) } : item);
      }
      return [...current, { ...product, quantity: 1 }];
    });
    setCartOpen(true);
  };

  const changeQuantity = (id: string, delta: number) => {
    setCart((current) => current
      .map((item) => item.id === id ? { ...item, quantity: Math.max(0, Math.min(item.stock, item.quantity + delta)) } : item)
      .filter((item) => item.quantity > 0));
  };

  const checkout = async () => {
    if (cart.length === 0) return;
    setCheckoutLoading(true);
    try {
      const redirectUrl = `${window.location.origin}/shop/${salonSlug}?status=payment-return`;
      const result = await callPublicShop<{ checkoutUrl?: string; order?: { order_number?: string } }>({
        action: "create_order",
        slug: salonSlug,
        customer,
        method,
        redirect_url: redirectUrl,
        items: cart.map((item) => ({ product_id: item.id, quantity: item.quantity })),
      });
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      setConfirmedOrder(result.order?.order_number || "Bestelling");
      setCart([]);
      setCartOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Afrekenen kon niet worden gestart.");
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>;
  }

  if (error || !shop) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="glass-card p-6 max-w-sm text-center">
          <p className="text-sm font-semibold">Shop niet beschikbaar</p>
          <p className="text-xs text-muted-foreground mt-1">{error || "Deze shop is nog niet actief."}</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={loadShop}>Opnieuw proberen</Button>
        </div>
      </div>
    );
  }

  if (confirmedOrder) {
    return (
      <div className={cn("min-h-screen bg-background p-4", isEmbed && "min-h-0")}>
        <div className="mx-auto max-w-lg glass-card p-6 text-center">
          <CheckCircle2 className="w-10 h-10 text-success mx-auto mb-3" />
          <h1 className="text-xl font-semibold">Bestelling ontvangen</h1>
          <p className="text-sm text-muted-foreground mt-2">Bedankt voor je bestelling bij {shop.salon.name}. Je betaalstatus wordt automatisch bijgewerkt.</p>
          <Button variant="outline" className="mt-5" onClick={() => setConfirmedOrder(null)}><ArrowLeft className="w-4 h-4" /> Verder winkelen</Button>
        </div>
      </div>
    );
  }

  return (
    <main className={cn("min-h-screen bg-background", isEmbed ? "p-3" : "p-4 sm:p-8")}>
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-3 mb-5">
          <div className="flex items-center gap-3 min-w-0">
            {shop.salon.logo_url ? <img src={shop.salon.logo_url} alt={shop.salon.name} className="w-10 h-10 rounded-xl object-cover" /> : <div className="w-10 h-10 rounded-xl bg-primary/15 flex items-center justify-center"><ShoppingBag className="w-5 h-5 text-primary" /></div>}
            <div className="min-w-0">
              <h1 className="text-lg font-semibold truncate">{shop.salon.name}</h1>
              <p className="text-xs text-muted-foreground">Productshop</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setCartOpen(true)}>
            <ShoppingCart className="w-4 h-4" /> {itemCount}
          </Button>
        </header>

        {shop.products.length === 0 ? (
          <div className="glass-card p-8 text-center text-sm text-muted-foreground">Nog geen online producten beschikbaar</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {shop.products.map((product) => (
              <article key={product.id} className="glass-card overflow-hidden flex flex-col">
                <div className="aspect-[4/3] bg-secondary/50 flex items-center justify-center">
                  {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" loading="lazy" /> : <ShoppingBag className="w-8 h-8 text-muted-foreground" />}
                </div>
                <div className="p-4 flex-1 flex flex-col gap-3">
                  <div className="flex-1">
                    <h2 className="text-sm font-semibold">{product.name}</h2>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{product.description || "Salonproduct"}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-bold text-primary">{formatEuro(product.price)}</span>
                    <Button variant="gradient" size="sm" onClick={() => addToCart(product)} disabled={product.stock < 1}>Toevoegen</Button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {cartOpen && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3" onClick={() => setCartOpen(false)}>
          <div className="glass-card w-full max-w-md max-h-[92vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold">Winkelmandje</h2>
              <Button variant="ghost" size="icon" onClick={() => setCartOpen(false)}>×</Button>
            </div>
            <div className="space-y-3">
              {cart.length === 0 ? <p className="text-sm text-muted-foreground text-center py-6">Je winkelmandje is leeg</p> : cart.map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/30">
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{item.name}</p><p className="text-xs text-muted-foreground">{formatEuro(item.price)}</p></div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="icon" onClick={() => changeQuantity(item.id, -1)}><Minus className="w-3 h-3" /></Button>
                    <span className="w-7 text-center text-sm">{item.quantity}</span>
                    <Button variant="outline" size="icon" onClick={() => changeQuantity(item.id, 1)}><Plus className="w-3 h-3" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => changeQuantity(item.id, -item.quantity)}><Trash2 className="w-3 h-3" /></Button>
                  </div>
                </div>
              ))}
            </div>

            {cart.length > 0 && (
              <div className="mt-5 space-y-3">
                <div className="grid grid-cols-1 gap-2">
                  <input value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Naam" className="px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm" />
                  <input value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} placeholder="E-mail" className="px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm" />
                  <input value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="Telefoon" className="px-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm" />
                  <div className="grid grid-cols-1 gap-2">
                    {paymentMethods.map((paymentMethod) => (
                      <button
                        key={paymentMethod.id}
                        type="button"
                        onClick={() => setMethod(paymentMethod.id)}
                        className={cn(
                          "min-h-12 rounded-xl border px-3 text-left text-sm font-medium transition-all flex items-center justify-between gap-3",
                          method === paymentMethod.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary/40 hover:bg-secondary/60"
                        )}
                      >
                        <span>{paymentMethod.label}</span>
                        <PaymentMethodLogo method={paymentMethod.id} className="h-6 max-w-24" />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-between text-sm font-semibold border-t border-border pt-3"><span>Totaal</span><span>{formatEuro(total)}</span></div>
                <Button variant="gradient" className="w-full" onClick={checkout} disabled={checkoutLoading}>{checkoutLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShoppingCart className="w-4 h-4" />} Afrekenen</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
