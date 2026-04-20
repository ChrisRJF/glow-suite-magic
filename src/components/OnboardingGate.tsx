import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useServices } from "@/hooks/useSupabaseData";
import { OnboardingWizard } from "./OnboardingWizard";

/** Auto-opens onboarding wizard for new users with empty salons. */
export function OnboardingGate() {
  const { user } = useAuth();
  const { data: services, loading } = useServices();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user || loading) return;
    const key = `glowsuite_onboarding_${user.id}`;
    const status = localStorage.getItem(key);
    if (status) return; // already done or skipped
    if (services.length === 0) {
      // Empty salon → show wizard
      const t = setTimeout(() => setOpen(true), 600);
      return () => clearTimeout(t);
    } else {
      // Has services → mark done so we don't bother again
      localStorage.setItem(key, "auto-done");
    }
  }, [user, services, loading]);

  return <OnboardingWizard open={open} onOpenChange={setOpen} />;
}
