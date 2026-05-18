// AI control modes — stored in settings.whitelabel_branding.ai_modes
// No new tables, no migration. Frontend-only orchestration layer.
import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AIMode = "off" | "suggestions" | "autopilot";

export type AICategory =
  | "betalingen"
  | "no_show"
  | "memberships"
  | "klant_retention"
  | "lege_plekken"
  | "campagnes";

export interface AIModes {
  global: AIMode;
  categories: Record<AICategory, AIMode>;
}

export const AI_CATEGORY_LABELS: Record<AICategory, string> = {
  betalingen: "Betalingen",
  no_show: "No-show preventie",
  memberships: "Memberships",
  klant_retention: "Klant-retentie",
  lege_plekken: "Lege plekken",
  campagnes: "Campagnes",
};

export const AI_MODE_LABELS: Record<AIMode, string> = {
  off: "Uit",
  suggestions: "Suggesties",
  autopilot: "Automatisch uitvoeren",
};

export const AI_MODE_SHORT: Record<AIMode, string> = {
  off: "Uit",
  suggestions: "Tip",
  autopilot: "Automatisch actief",
};

export const DEFAULT_AI_MODES: AIModes = {
  global: "suggestions",
  categories: {
    betalingen: "suggestions",
    no_show: "suggestions",
    memberships: "suggestions",
    klant_retention: "suggestions",
    lege_plekken: "suggestions",
    campagnes: "suggestions",
  },
};

function normalize(raw: any): AIModes {
  if (!raw || typeof raw !== "object") return DEFAULT_AI_MODES;
  const validModes: AIMode[] = ["off", "suggestions", "autopilot"];
  const safeMode = (v: any, fb: AIMode): AIMode => (validModes.includes(v) ? v : fb);
  return {
    global: safeMode(raw.global, DEFAULT_AI_MODES.global),
    categories: {
      betalingen: safeMode(raw.categories?.betalingen, DEFAULT_AI_MODES.categories.betalingen),
      no_show: safeMode(raw.categories?.no_show, DEFAULT_AI_MODES.categories.no_show),
      memberships: safeMode(raw.categories?.memberships, DEFAULT_AI_MODES.categories.memberships),
      klant_retention: safeMode(raw.categories?.klant_retention, DEFAULT_AI_MODES.categories.klant_retention),
      lege_plekken: safeMode(raw.categories?.lege_plekken, DEFAULT_AI_MODES.categories.lege_plekken),
      campagnes: safeMode(raw.categories?.campagnes, DEFAULT_AI_MODES.categories.campagnes),
    },
  };
}

/** Effective mode = stricter of global vs category. */
export function effectiveMode(modes: AIModes, category: AICategory): AIMode {
  const order: AIMode[] = ["off", "suggestions", "autopilot"];
  const g = order.indexOf(modes.global);
  const c = order.indexOf(modes.categories[category]);
  return order[Math.min(g, c)];
}

export function useAIModes() {
  const { user } = useAuth();
  const [modes, setModes] = useState<AIModes>(DEFAULT_AI_MODES);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [branding, setBranding] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("settings")
        .select("id, whitelabel_branding")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (data) {
        setSettingsId((data as any).id);
        const b = ((data as any).whitelabel_branding && typeof (data as any).whitelabel_branding === "object")
          ? (data as any).whitelabel_branding : {};
        setBranding(b);
        setModes(normalize(b.ai_modes));
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [user]);

  const persist = useCallback(async (next: AIModes) => {
    setModes(next);
    if (!settingsId) return;
    setSaving(true);
    const merged = { ...branding, ai_modes: next };
    const { error } = await supabase
      .from("settings")
      .update({ whitelabel_branding: merged })
      .eq("id", settingsId);
    setSaving(false);
    if (!error) setBranding(merged);
    return !error;
  }, [settingsId, branding]);

  const setGlobal = (m: AIMode) => persist({ ...modes, global: m });
  const setCategory = (c: AICategory, m: AIMode) =>
    persist({ ...modes, categories: { ...modes.categories, [c]: m } });

  return { modes, loading, saving, setGlobal, setCategory };
}
