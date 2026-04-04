import { AppLayout } from "@/components/AppLayout";
import { formatEuro } from "@/lib/data";
import { Package, Search } from "lucide-react";
import { useState } from "react";

const productList = [
  { id: "1", name: "Professionele shampoo", category: "Haarverzorging", price: 18.50, stock: 24 },
  { id: "2", name: "Haarmasker premium", category: "Haarverzorging", price: 24.00, stock: 12 },
  { id: "3", name: "Styling gel", category: "Styling", price: 14.00, stock: 31 },
  { id: "4", name: "Haarolie argan", category: "Haarverzorging", price: 22.00, stock: 8 },
  { id: "5", name: "Gezichtscrème", category: "Huidverzorging", price: 35.00, stock: 15 },
  { id: "6", name: "Nagellak set", category: "Nagels", price: 12.00, stock: 40 },
  { id: "7", name: "Wenkbrauwgel", category: "Make-up", price: 9.50, stock: 22 },
  { id: "8", name: "Haarspray strong hold", category: "Styling", price: 16.00, stock: 18 },
];

export default function ProductenPage() {
  const [search, setSearch] = useState("");
  const filtered = productList.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <AppLayout title="Producten" subtitle="Productoverzicht en voorraad">
      <div className="grid gap-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Zoek producten..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-secondary/50 border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div className="glass-card overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Product</th>
                <th className="text-left text-xs font-medium text-muted-foreground p-4">Categorie</th>
                <th className="text-right text-xs font-medium text-muted-foreground p-4">Prijs</th>
                <th className="text-right text-xs font-medium text-muted-foreground p-4">Voorraad</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/20 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-secondary">
                        <Package className="w-4 h-4 text-primary" />
                      </div>
                      <span className="text-sm font-medium">{p.name}</span>
                    </div>
                  </td>
                  <td className="p-4 text-sm text-muted-foreground">{p.category}</td>
                  <td className="p-4 text-sm text-right font-medium">{formatEuro(p.price)}</td>
                  <td className="p-4 text-right">
                    <span className={`text-sm font-medium ${p.stock < 10 ? "text-destructive" : "text-emerald-400"}`}>
                      {p.stock}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  );
}
