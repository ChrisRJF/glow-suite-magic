import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

interface Testimonial {
  id: string;
  salon_name: string;
  city: string | null;
  quote: string;
  rating: number;
  featured: boolean;
}

export function TestimonialsSection() {
  const [items, setItems] = useState<Testimonial[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("testimonials" as any)
          .select("id,salon_name,city,quote,rating,featured")
          .eq("status", "approved")
          .order("featured", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(9);
        if (!cancelled) setItems((data as unknown as Testimonial[]) ?? []);
      } catch (_e) {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) return null;
  if (items.length === 0) return null;

  return (
    <section className="w-full px-5 sm:px-8 py-12 sm:py-20">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-3xl mx-auto text-center mb-10 sm:mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold tracking-wide uppercase mb-4">
            <Star className="w-3.5 h-3.5 fill-current" />
            Wat salons over GlowSuite zeggen
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Salons die elke maand meer omzet maken
          </h2>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
          {items.map((t) => (
            <Card key={t.id} className="p-5 sm:p-6 flex flex-col">
              <div className="flex items-center gap-0.5 mb-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Star
                    key={i}
                    className={`w-4 h-4 ${
                      i < t.rating
                        ? "text-warning fill-warning"
                        : "text-muted-foreground/30"
                    }`}
                  />
                ))}
              </div>
              <p className="text-sm sm:text-base text-foreground leading-relaxed flex-1">
                "{t.quote}"
              </p>
              <div className="mt-4 pt-4 border-t border-border/60">
                <p className="font-semibold text-sm">{t.salon_name}</p>
                {t.city && (
                  <p className="text-xs text-muted-foreground">{t.city}</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
