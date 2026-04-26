import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Gift,
  Copy,
  Check,
  MessageCircle,
  Instagram,
  Loader2,
  Users,
  Award,
  Coins,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/hooks/use-toast";
import { trackEvent } from "@/hooks/useAnalytics";

interface ReferralData {
  code: string;
  total_referred: number;
  total_converted: number;
  total_credit_months: number;
  credit_months_balance: number;
  referrals: Array<{
    id: string;
    status: string;
    signed_up_at: string;
    converted_at: string | null;
  }>;
}

export function ReferralCard() {
  const { user } = useAuth();
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: res, error } = await supabase.functions.invoke(
          "referral-bootstrap",
        );
        if (cancelled) return;
        if (error) throw error;
        setData(res as ReferralData);
      } catch (_e) {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (loading) {
    return (
      <Card className="p-6 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (!data) return null;

  const inviteUrl = `${window.location.origin}/login?mode=signup&ref=${data.code}`;
  const shareText = `Ik gebruik GlowSuite voor mijn salon en het is geweldig. Met deze link krijg je 30 dagen gratis: ${inviteUrl}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      trackEvent("referral_sent", { channel: "copy", code: data.code });
      toast({ title: "Link gekopieerd" });
      setTimeout(() => setCopied(false), 2000);
    } catch (_e) {
      toast({ title: "Kopiëren mislukt", variant: "destructive" });
    }
  };

  const shareWhatsApp = () => {
    trackEvent("referral_sent", { channel: "whatsapp", code: data.code });
    window.open(
      `https://wa.me/?text=${encodeURIComponent(shareText)}`,
      "_blank",
      "noopener,noreferrer",
    );
  };

  const shareInstagram = async () => {
    trackEvent("referral_sent", { channel: "instagram", code: data.code });
    // Instagram has no DM web intent; copy + open Instagram
    try {
      await navigator.clipboard.writeText(shareText);
      toast({
        title: "Tekst gekopieerd",
        description: "Plak in een Instagram DM om te delen.",
      });
    } catch (_e) { /* */ }
    window.open("https://www.instagram.com/direct/inbox/", "_blank", "noopener,noreferrer");
  };

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start gap-3 mb-4">
        <div className="p-2 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20">
          <Gift className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground">
            Verdien gratis maanden
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Nodig een collega-salon uit. Zij krijgen 30 dagen gratis, jij krijgt
            een gratis maand zodra zij betalend worden.
          </p>
        </div>
      </div>

      {/* Share code */}
      <div className="rounded-xl border border-dashed border-border bg-secondary/30 p-3 sm:p-4 mb-3">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
          Jouw code
        </p>
        <p className="text-2xl sm:text-3xl font-mono font-bold tracking-wider text-foreground">
          {data.code}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <Button
          variant="outline"
          className="w-full h-11 px-2"
          onClick={shareWhatsApp}
        >
          <MessageCircle className="w-4 h-4 sm:mr-1.5" />
          <span className="hidden sm:inline">WhatsApp</span>
        </Button>
        <Button
          variant="outline"
          className="w-full h-11 px-2"
          onClick={shareInstagram}
        >
          <Instagram className="w-4 h-4 sm:mr-1.5" />
          <span className="hidden sm:inline">Instagram</span>
        </Button>
        <Button
          variant="outline"
          className="w-full h-11 px-2"
          onClick={copyLink}
        >
          {copied ? (
            <Check className="w-4 h-4 sm:mr-1.5" />
          ) : (
            <Copy className="w-4 h-4 sm:mr-1.5" />
          )}
          <span className="hidden sm:inline">{copied ? "Gekopieerd" : "Kopieer"}</span>
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border/60">
        <div className="text-center">
          <Users className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
          <p className="text-xl font-bold">{data.total_referred}</p>
          <p className="text-[11px] text-muted-foreground">Uitgenodigd</p>
        </div>
        <div className="text-center">
          <Award className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
          <p className="text-xl font-bold">{data.total_converted}</p>
          <p className="text-[11px] text-muted-foreground">Betalend</p>
        </div>
        <div className="text-center">
          <Coins className="w-4 h-4 mx-auto text-muted-foreground mb-1" />
          <p className="text-xl font-bold text-success">
            {data.credit_months_balance}
          </p>
          <p className="text-[11px] text-muted-foreground">Gratis maanden</p>
        </div>
      </div>

      {data.credit_months_balance > 0 && (
        <div className="mt-4 p-3 rounded-xl bg-success/10 border border-success/30 text-success text-xs flex items-center gap-2">
          <Coins className="w-4 h-4 shrink-0" />
          <span>
            Je hebt <strong>{data.credit_months_balance}</strong>{" "}
            gratis {data.credit_months_balance === 1 ? "maand" : "maanden"} tegoed.
            Wordt automatisch verrekend bij volgende incasso.
          </span>
        </div>
      )}

      {data.referrals.length > 0 && (
        <details className="mt-4 pt-4 border-t border-border/60 group">
          <summary className="cursor-pointer text-sm font-medium text-foreground list-none flex items-center justify-between">
            Recente uitnodigingen ({data.referrals.length})
            <span className="text-muted-foreground text-xs group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <div className="mt-3 space-y-2">
            {data.referrals.slice(0, 10).map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between text-xs py-1.5"
              >
                <span className="text-muted-foreground">
                  {new Date(r.signed_up_at).toLocaleDateString("nl-NL", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
                <Badge
                  variant="secondary"
                  className={
                    r.status === "credited"
                      ? "bg-success/15 text-success"
                      : r.status === "converted"
                        ? "bg-primary/15 text-primary"
                        : "bg-muted text-muted-foreground"
                  }
                >
                  {r.status === "credited"
                    ? "Verrekend"
                    : r.status === "converted"
                      ? "Betalend"
                      : "Aangemeld"}
                </Badge>
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}
