import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Share2, Copy, Sparkles, Image, Tag, Clock, Gift, Package, Scissors } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PostTemplate {
  id: string;
  category: string;
  icon: typeof Sparkles;
  title: string;
  caption: string;
  hashtags: string;
}

const templates: PostTemplate[] = [
  {
    id: "1", category: "Last-minute", icon: Clock, title: "Last-minute deal",
    caption: "⚡ Vandaag nog een plekje vrij! Boek nu je [behandeling] met [X]% korting.\n\n📱 Boek direct via de link in bio!",
    hashtags: "#lastminute #salon #aanbieding #beauty #kappersdeal",
  },
  {
    id: "2", category: "Nieuwe behandeling", icon: Sparkles, title: "Nieuwe behandeling",
    caption: "✨ NIEUW bij ons! Ontdek onze nieuwe [behandeling].\n\nSpeciaal voor jou klaar door ons team. Boek nu je eerste afspraak!\n\n📱 Link in bio",
    hashtags: "#nieuw #behandeling #beauty #salon #selfcare",
  },
  {
    id: "3", category: "Cadeaubon", icon: Gift, title: "Cadeaubon promo",
    caption: "🎁 Op zoek naar het perfecte cadeau?\n\nGeef een cadeaubon van [salon naam]! Verkrijgbaar vanaf €25.\n\n💝 Bestel online of in de salon.",
    hashtags: "#cadeaubon #cadeau #beauty #giftcard #salon",
  },
  {
    id: "4", category: "Lege plekken", icon: Clock, title: "Lege plekken actie",
    caption: "📅 Deze week nog plekken beschikbaar!\n\n🕐 [dag] — [tijd]\n🕐 [dag] — [tijd]\n\nBoek snel voordat het vol zit! 📱",
    hashtags: "#beschikbaar #afspraak #salon #beauty #book",
  },
  {
    id: "5", category: "Product promo", icon: Package, title: "Product spotlight",
    caption: "💇‍♀️ Productfavoriet van de maand: [product naam]!\n\n✅ [voordeel 1]\n✅ [voordeel 2]\n✅ [voordeel 3]\n\nNu verkrijgbaar in de salon & online shop!",
    hashtags: "#product #beauty #haircare #skincare #salon",
  },
  {
    id: "6", category: "Team", icon: Scissors, title: "Team introductie",
    caption: "👋 Maak kennis met [medewerker naam]!\n\n[Medewerker] is specialist in [specialisatie] en staat klaar om jou de beste ervaring te geven.\n\nBoek nu bij [naam]! 📱",
    hashtags: "#team #kapper #stylist #beauty #salon",
  },
];

export default function SocialStudioPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>("alle");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState("");

  const categories = ["alle", ...Array.from(new Set(templates.map(t => t.category)))];

  const filtered = selectedCategory === "alle"
    ? templates
    : templates.filter(t => t.category === selectedCategory);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Gekopieerd naar klembord!");
  };

  return (
    <AppLayout title="Social Studio" subtitle="Content templates voor social media">
      <div className="grid gap-6">
        {/* Category filter */}
        <div className="flex gap-1 overflow-x-auto pb-1">
          {categories.map(c => (
            <button key={c} onClick={() => setSelectedCategory(c)}
              className={cn("px-3 py-1.5 rounded-xl text-xs font-medium whitespace-nowrap transition-all",
                selectedCategory === c ? "bg-primary/15 text-primary" : "bg-secondary/50 text-muted-foreground hover:text-foreground")}>
              {c === "alle" ? "Alle templates" : c}
            </button>
          ))}
        </div>

        {/* Templates */}
        <div className="grid sm:grid-cols-2 gap-4">
          {filtered.map(t => (
            <div key={t.id} className="glass-card p-5 flex flex-col">
              <div className="flex items-start gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <t.icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{t.title}</p>
                  <p className="text-[11px] text-muted-foreground">{t.category}</p>
                </div>
              </div>

              {editingId === t.id ? (
                <textarea value={editCaption} onChange={e => setEditCaption(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-xl bg-secondary/50 border border-border text-sm whitespace-pre-wrap min-h-[120px] focus:outline-none focus:ring-2 focus:ring-primary/30 mb-2" />
              ) : (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap flex-1 mb-2">{t.caption}</p>
              )}

              <p className="text-[11px] text-primary/70 mb-3">{t.hashtags}</p>

              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1"
                  onClick={() => copyToClipboard(editingId === t.id ? editCaption + "\n\n" + t.hashtags : t.caption + "\n\n" + t.hashtags)}>
                  <Copy className="w-3.5 h-3.5" /> Kopieer
                </Button>
                {editingId === t.id ? (
                  <Button variant="gradient" size="sm" className="flex-1"
                    onClick={() => { setEditingId(null); toast.success("Tekst aangepast"); }}>
                    Opslaan
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" className="flex-1"
                    onClick={() => { setEditingId(t.id); setEditCaption(t.caption); }}>
                    ✏️ Bewerken
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  );
}