import { supabase } from "@/integrations/supabase/client";

/**
 * Account-level onboarding preference persistence.
 *
 * Server-authoritative state lives in settings.whitelabel_branding.onboarding_v4
 * (existing jsonb column, owner-scoped RLS: auth.uid() = user_id). localStorage
 * remains an immediate UX cache; the server value wins across devices/sessions.
 *
 * States: "dismissed" (X/Escape/Later — wizard may be resumed via Instellingen),
 * "done" / "skipped" (completed). All writes are fail-safe: network errors are
 * swallowed so the wizard never blocks on persistence.
 */

export type OnboardingState = "dismissed" | "done" | "skipped";

const KEY = "onboarding_v4";

export function readServerOnboardingState(branding: unknown): OnboardingState | null {
  const v = (branding as any)?.[KEY]?.state;
  return v === "dismissed" || v === "done" || v === "skipped" ? v : null;
}

export async function fetchServerOnboardingState(userId: string): Promise<OnboardingState | null> {
  try {
    const { data, error } = await supabase
      .from("settings")
      .select("whitelabel_branding")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return null;
    return readServerOnboardingState(data?.whitelabel_branding);
  } catch {
    return null;
  }
}

export async function persistOnboardingState(userId: string, state: OnboardingState): Promise<void> {
  try {
    const { data: row } = await supabase
      .from("settings")
      .select("whitelabel_branding")
      .eq("user_id", userId)
      .maybeSingle();
    const branding = { ...((row?.whitelabel_branding as any) ?? {}) };
    branding[KEY] = { state, at: new Date().toISOString() };
    if (row) {
      await supabase
        .from("settings")
        .update({ whitelabel_branding: branding })
        .eq("user_id", userId);
    } else {
      await supabase
        .from("settings")
        .insert({ user_id: userId, whitelabel_branding: branding });
    }
  } catch {
    // Fail-safe: localStorage cache still holds the state for this device.
  }
}
