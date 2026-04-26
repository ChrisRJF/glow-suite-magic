import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Star, ExternalLink, Loader2, Heart } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { trackEvent } from "@/hooks/useAnalytics";
import { toast } from "@/hooks/use-toast";

type Phase = "rate" | "testimonial" | "feedback" | "thanks_high" | "thanks_low";

const MIN_DAYS_ACTIVE = 3;
const MIN_BOOKINGS = 3;

export function ReviewPromptModal() {
  const { user, bootstrapReady } = useAuth();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("rate");
  const [rating, setRating] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [quote, setQuote] = useState("");
  const [city, setCity] = useState("");
  const [salonName, setSalonName] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleUrl, setGoogleUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !bootstrapReady) return;
    let cancelled = false;

    (async () => {
      try {
        // 1. Already prompted?
        const { data: prompt } = await supabase
          .from("review_prompts" as any)
          .select("shown_at,dismissed_at,responded_at")
          .eq("user_id", user.id)
          .maybeSingle() as any;
        if (prompt?.shown_at || prompt?.responded_at || prompt?.dismissed_at) return;

        // 2. Days active (profile created_at)
        const { data: prof } = await supabase
          .from("profiles")
          .select("created_at,salon_name,city,google_review_url")
          .eq("user_id", user.id)
          .maybeSingle();
        if (!prof) return;
        const created = new Date(prof.created_at);
        const days = Math.floor((Date.now() - created.getTime()) / 86_400_000);
        if (days < MIN_DAYS_ACTIVE) return;

        // 3. Bookings count
        const { count } = await supabase
          .from("appointments")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("is_demo", false);
        if ((count ?? 0) < MIN_BOOKINGS) return;

        if (cancelled) return;
        setSalonName(prof.salon_name || "");
        setCity((prof as any).city || "");
        setGoogleUrl((prof as any).google_review_url || null);
        setOpen(true);

        // Mark shown
        await supabase
          .from("review_prompts" as any)
          .upsert(
            { user_id: user.id, shown_at: new Date().toISOString() },
            { onConflict: "user_id" },
          );
        trackEvent("review_prompt_shown", { days_active: days, bookings: count });
      } catch (_e) { /* noop */ }
    })();

    return () => { cancelled = true; };
  }, [user, bootstrapReady]);

  const onClose = async () => {
    if (user && rating === 0) {
      await supabase
        .from("review_prompts" as any)
        .upsert(
          { user_id: user.id, dismissed_at: new Date().toISOString() },
          { onConflict: "user_id" },
        );
      trackEvent("review_prompt_dismissed");
    }
    setOpen(false);
  };

  const onSelectRating = async (r: number) => {
    setRating(r);
    if (!user) return;
    await supabase
      .from("review_prompts" as any)
      .upsert(
        { user_id: user.id, rating: r, responded_at: new Date().toISOString() },
        { onConflict: "user_id" },
      );
    trackEvent("review_submitted", { rating: r });
    setPhase(r >= 5 ? "testimonial" : "feedback");
  };

  const submitTestimonial = async () => {
    if (!user || quote.trim().length < 5) {
      toast({ title: "Voeg een korte quote toe (min. 5 tekens)", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.from("testimonials" as any).insert({
        user_id: user.id,
        salon_name: salonName.trim() || "Mijn Salon",
        city: city.trim() || null,
        quote: quote.trim(),
        rating: 5,
        status: "pending",
      });
      if (error) throw error;
      trackEvent("testimonial_submitted", { rating: 5 });
      setPhase("thanks_high");
    } catch (e: any) {
      toast({
        title: "Versturen mislukt",
        description: e?.message || "Probeer het opnieuw.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const submitFeedback = async () => {
    if (!user) return;
    setBusy(true);
    try {
      if (feedback.trim()) {
        await supabase.from("feedback_entries").insert({
          user_id: user.id,
          rating,
          comment: feedback.trim().slice(0, 1000),
          is_demo: false,
        });
      }
      setPhase("thanks_low");
    } catch (_e) {
      setPhase("thanks_low");
    } finally {
      setBusy(false);
    }
  };

  const onGoogleClick = () => {
    if (!googleUrl) return;
    trackEvent("google_review_clicked");
    window.open(googleUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md p-5 sm:p-6">
        {phase === "rate" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">
                Hoe bevalt GlowSuite tot nu toe?
              </DialogTitle>
              <DialogDescription>
                Eén tik. Helpt ons enorm.
              </DialogDescription>
            </DialogHeader>
            <div
              className="flex items-center justify-center gap-1.5 sm:gap-2 py-6"
              onMouseLeave={() => setHover(0)}
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onSelectRating(n)}
                  onMouseEnter={() => setHover(n)}
                  className="p-2 transition-transform active:scale-90 min-w-[44px] min-h-[44px]"
                  aria-label={`${n} sterren`}
                >
                  <Star
                    className={`w-9 h-9 sm:w-10 sm:h-10 transition-colors ${
                      n <= (hover || rating)
                        ? "text-warning fill-warning"
                        : "text-muted-foreground/40"
                    }`}
                  />
                </button>
              ))}
            </div>
            <Button variant="ghost" className="w-full" onClick={onClose}>
              Later
            </Button>
          </>
        )}

        {phase === "testimonial" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Heart className="w-5 h-5 text-primary fill-primary/20" />
                Geweldig — bedankt!
              </DialogTitle>
              <DialogDescription>
                Wil je in 1 zin delen wat je het fijnst vindt? We tonen het
                graag op onze website.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 mt-2">
              <div>
                <label className="text-xs text-muted-foreground">Salon</label>
                <input
                  value={salonName}
                  onChange={(e) => setSalonName(e.target.value)}
                  maxLength={120}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl bg-secondary/50 border border-border text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Stad</label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  maxLength={80}
                  placeholder="Bijv. Amsterdam"
                  className="w-full mt-1 px-3 py-2.5 rounded-xl bg-secondary/50 border border-border text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Jouw quote</label>
                <textarea
                  value={quote}
                  onChange={(e) => setQuote(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Wat maakt GlowSuite voor jou waardevol?"
                  className="w-full mt-1 px-3 py-2.5 rounded-xl bg-secondary/50 border border-border text-base sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
                <p className="text-[11px] text-muted-foreground mt-1">
                  {quote.length}/500
                </p>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button
                variant="gradient"
                className="w-full h-11"
                onClick={submitTestimonial}
                disabled={busy}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Versturen"}
              </Button>
              <Button variant="ghost" className="w-full sm:w-auto h-11" onClick={onClose}>
                Sluiten
              </Button>
            </div>
          </>
        )}

        {phase === "feedback" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Bedankt voor je eerlijkheid</DialogTitle>
              <DialogDescription>
                Wat kan beter? Eén zin is genoeg — we lezen alles.
              </DialogDescription>
            </DialogHeader>
            <textarea
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              rows={4}
              maxLength={1000}
              placeholder="Wat zou jij verbeteren?"
              className="w-full mt-3 px-3 py-2.5 rounded-xl bg-secondary/50 border border-border text-base sm:text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <div className="flex flex-col sm:flex-row gap-2 mt-4">
              <Button
                variant="gradient"
                className="w-full h-11"
                onClick={submitFeedback}
                disabled={busy}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Versturen"}
              </Button>
              <Button variant="ghost" className="w-full sm:w-auto h-11" onClick={onClose}>
                Sluiten
              </Button>
            </div>
          </>
        )}

        {phase === "thanks_high" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl flex items-center gap-2">
                <Heart className="w-5 h-5 text-primary fill-primary/20" />
                Bedankt!
              </DialogTitle>
              <DialogDescription>
                {googleUrl
                  ? "Help anderen je salon én GlowSuite ontdekken — laat een Google review achter."
                  : "Je quote wordt na korte review getoond op onze site."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 mt-4">
              {googleUrl && (
                <Button variant="gradient" className="w-full h-11" onClick={onGoogleClick}>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Plaats Google review
                </Button>
              )}
              <Button variant="ghost" className="w-full h-11" onClick={onClose}>
                Sluiten
              </Button>
            </div>
          </>
        )}

        {phase === "thanks_low" && (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl">Dankjewel</DialogTitle>
              <DialogDescription>
                We pakken je feedback op. Heb je iets dringends? Mail ons op
                support@glowsuite.nl.
              </DialogDescription>
            </DialogHeader>
            <Button variant="gradient" className="w-full h-11 mt-4" onClick={onClose}>
              Sluiten
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
