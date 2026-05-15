import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSettings } from "@/hooks/useSupabaseData";
import { useUserRole } from "@/hooks/useUserRole";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";
import { GlowPayActivationWizard } from "./GlowPayActivationWizard";
import { supabase } from "@/integrations/supabase/client";

const HIDDEN_PATHS = ["/login", "/reset-password", "/boeken", "/shop", "/memberships", "/abonnementen", "/payment", "/integrations", "/afspraak", "/review", "/route-contact", "/betaalbewijs", "/abonnement-beheren", "/salonvoorwaarden"];

/** Tracks GlowSuite onboarding progress and auto-opens the activation wizard.
 *  Demo-aware: onboarding still appears in demo mode so users can experience it.
 *  When dismissed, a persistent floating CTA remains until activation is complete. */
export function GlowPayActivationGate() {
  const { user } = useAuth();
  const { isOwner } = useUserRole();
  const { data: settings } = useSettings();
  const location = useLocation();
  const settingsRow: any = settings?.[0];
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const branding = (settingsRow?.whitelabel_branding && typeof settingsRow.whitelabel_branding === "object") ? settingsRow.whitelabel_branding : {};
  const activation = branding.glowpay_activation || {};
  const completed = Boolean(activation.completed || activation.onboarding_completed);
  const stepNum = Number(activation.onboarding_step ?? activation.step ?? 0);
  const totalSteps = 7;
  const pct = Math.min(100, Math.round(((stepNum + (activation.first_payment_completed ? 1 : 0)) / totalSteps) * 100));

  const hidden = useMemo(() => HIDDEN_PATHS.some((p) => location.pathname.startsWith(p)), [location.pathname]);

  // Auto-open once for new owners with no completed activation (demo or live).
  useEffect(() => {
    if (!user || !isOwner || !settingsRow || completed || hidden) return;
    const key = `glowpay_activation_seen_${user.id}`;
    if (sessionStorage.getItem(key)) return;
    const t = setTimeout(() => {
      setOpen(true);
      sessionStorage.setItem(key, "1");
      // Stamp started_at once
      if (!activation.started_at && settingsRow?.id) {
        const next = { ...activation, started_at: new Date().toISOString() };
        supabase.from("settings").update({ whitelabel_branding: { ...branding, glowpay_activation: next } as any }).eq("id", settingsRow.id);
      }
    }, 900);
    return () => clearTimeout(t);
  }, [user?.id, isOwner, settingsRow?.id, completed, hidden]);

  // Persist abandoned_step when wizard closes without completion
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next && !completed && settingsRow?.id) {
      const patch = { ...activation, abandoned_step: stepNum, abandoned_at: new Date().toISOString() };
      supabase.from("settings").update({ whitelabel_branding: { ...branding, glowpay_activation: patch } as any }).eq("id", settingsRow.id);
    }
  };

  if (!user || !isOwner || hidden) {
    return <GlowPayActivationWizard open={open} onOpenChange={handleOpenChange} />;
  }

  const showCta = !completed && !open && Boolean(settingsRow);

  return (
    <>
      {showCta && !collapsed && (
        <div className="fixed bottom-3 right-3 left-3 sm:left-auto sm:max-w-sm z-40 rounded-2xl border border-border/60 bg-card/95 backdrop-blur shadow-elegant p-3.5 flex items-center gap-3 animate-fade-in">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-primary-glow flex items-center justify-center flex-shrink-0 ring-1 ring-primary/20">
            <Sparkles className="w-4 h-4 text-primary-foreground" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold leading-tight tracking-tight">Je salon activeren</p>
            <Progress value={pct} className="h-1 mt-1.5" />
            <p className="text-[11px] text-muted-foreground mt-1">{pct}% voltooid</p>
          </div>
          <Button size="sm" variant="gradient" onClick={() => setOpen(true)} className="h-8 text-[12px] flex-shrink-0 rounded-lg shadow-sm">Verder</Button>
          <button onClick={() => setCollapsed(true)} className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Minimaliseren">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {showCta && collapsed && (
        <button
          onClick={() => { setCollapsed(false); setOpen(true); }}
          className="fixed bottom-4 right-4 z-40 w-12 h-12 rounded-full bg-gradient-to-br from-primary to-primary-glow text-primary-foreground shadow-elegant ring-1 ring-primary/20 flex items-center justify-center hover-scale animate-fade-in"
          aria-label="Salon activeren"
          title={`Je salon activeren — ${pct}%`}
        >
          <Sparkles className="w-5 h-5" strokeWidth={1.75} />
        </button>
      )}
      <GlowPayActivationWizard open={open} onOpenChange={handleOpenChange} />
    </>
  );
}
