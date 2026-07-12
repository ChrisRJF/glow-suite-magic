import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useServices } from "@/hooks/useSupabaseData";
import { useUserRole } from "@/hooks/useUserRole";
import { useDemoMode } from "@/hooks/useDemoMode";
import { supabase } from "@/integrations/supabase/client";
import { OnboardingWizard } from "./OnboardingWizard";

/**
 * Canonical onboarding gate. Single source of truth.
 *
 * Auto-open rule (all must be true):
 *  - user is owner/admin/manager
 *  - no completion flag exists (any legacy key OR the v4 key OR whitelabel_branding.glowpay_activation.completed)
 *  - not in demo mode
 *  - salon has no meaningful initial setup (no services, no employees, no customers, no appointments)
 *
 * Legacy completion sources migrated → v4:
 *  - glowsuite_onboarding_<uid>
 *  - glowsuite_onboarding_v3_<uid>  (partial state store; treat "done" values as complete)
 *  - settings.whitelabel_branding.glowpay_activation.completed  (old GlowPayActivationWizard)
 */

const V4_KEY = (uid: string) => `glowsuite_onboarding_v4_${uid}`;
const LEGACY_KEYS = (uid: string) => [
  `glowsuite_onboarding_${uid}`,
  `glowsuite_onboarding_v3_${uid}`,
];

function hasLocalCompletion(uid: string): boolean {
  try {
    if (localStorage.getItem(V4_KEY(uid))) return true;
    for (const k of LEGACY_KEYS(uid)) {
      const v = localStorage.getItem(k);
      if (!v) continue;
      // v3 stores JSON progress; treat any value as evidence of prior interaction only when it's a completion marker
      if (v === "done" || v === "skipped" || v === "auto-done" || v === "migrated") return true;
    }
  } catch {}
  return false;
}

function markCompleted(uid: string, reason: string) {
  try { localStorage.setItem(V4_KEY(uid), reason); } catch {}
}

export function OnboardingGate() {
  const { user, loading: authLoading, bootstrapReady } = useAuth();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const { demoMode, loading: demoLoading } = useDemoMode();
  const { data: services, loading } = useServices();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!user || authLoading || !bootstrapReady || roleLoading || demoLoading || loading || checked) return;
    setChecked(true);

    // Non-admins never see onboarding
    if (!isAdmin) { markCompleted(user.id, "no-role"); return; }

    // Demo mode: never auto-open. Preview only via Instellingen.
    if (demoMode) return;

    // Already completed (any source in localStorage)?
    if (hasLocalCompletion(user.id)) return;

    (async () => {
      // Check legacy GlowPay activation completion on settings row → migrate.
      try {
        const { data: s } = await supabase
          .from("settings")
          .select("whitelabel_branding")
          .eq("user_id", user.id)
          .maybeSingle();
        const activation: any = (s?.whitelabel_branding as any)?.glowpay_activation;
        if (activation?.completed || activation?.onboarding_completed) {
          markCompleted(user.id, "migrated-glowpay");
          return;
        }
      } catch {}

      // Meaningful initial setup? If yes, silently mark done.
      if (services.length > 0) {
        markCompleted(user.id, "has-services");
        return;
      }

      // Additional signals — any of these means the salon isn't blank.
      try {
        const [{ count: empCount }, { count: custCount }, { count: apptCount }] = await Promise.all([
          supabase.from("employees").select("id", { count: "exact", head: true }).eq("user_id", user.id),
          supabase.from("customers").select("id", { count: "exact", head: true }).eq("user_id", user.id),
          supabase.from("appointments").select("id", { count: "exact", head: true }).eq("user_id", user.id),
        ]);
        if ((empCount ?? 0) > 0 || (custCount ?? 0) > 0 || (apptCount ?? 0) > 0) {
          markCompleted(user.id, "has-data");
          return;
        }
      } catch {}

      // Truly empty salon → open unified onboarding.
      setTimeout(() => setOpen(true), 250);
    })();
  }, [user, authLoading, bootstrapReady, roleLoading, demoLoading, isAdmin, demoMode, services, loading, checked]);

  return <OnboardingWizard open={open} onOpenChange={setOpen} />;
}
