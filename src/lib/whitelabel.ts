// White-label branding for the embedded booking widget.
// Primary store: settings.whitelabel_branding (syncs across devices).
// Fallback: localStorage (offline / pre-login preview).

import { supabase } from "@/integrations/supabase/client";

export interface WhiteLabelBranding {
  salon_name: string;
  logo_url: string;
  primary_color: string;
  secondary_color: string;
  button_radius: number;
  font_preset: "inter" | "system" | "serif";
  show_logo: boolean;
  hide_glowsuite_branding: boolean;
}

const STORAGE_KEY = "glowsuite_whitelabel_branding";

export const defaultBranding: WhiteLabelBranding = {
  salon_name: "Glow Studio",
  logo_url: "",
  primary_color: "#7B61FF",
  secondary_color: "#C850C0",
  button_radius: 12,
  font_preset: "inter",
  show_logo: true,
  hide_glowsuite_branding: true,
};

function readLocal(): WhiteLabelBranding {
  if (typeof window === "undefined") return defaultBranding;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultBranding;
    return { ...defaultBranding, ...JSON.parse(raw) };
  } catch {
    return defaultBranding;
  }
}

function writeLocal(branding: WhiteLabelBranding) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(branding));
  } catch {
    /* ignore */
  }
}

/** Synchronous read — returns cached/local copy. Use for instant render. */
export function getBranding(): WhiteLabelBranding {
  return readLocal();
}

/** Async read — fetches from settings table for the logged-in user, falls back to local. */
export async function fetchBranding(): Promise<WhiteLabelBranding> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return readLocal();
    const { data, error } = await supabase
      .from("settings")
      .select("whitelabel_branding")
      .eq("user_id", auth.user.id)
      .maybeSingle();
    if (error) return readLocal();
    const remote = (data as any)?.whitelabel_branding as Partial<WhiteLabelBranding> | null;
    if (remote && typeof remote === "object") {
      const merged = { ...defaultBranding, ...remote };
      writeLocal(merged);
      return merged;
    }
    return readLocal();
  } catch {
    return readLocal();
  }
}

/** Async fetch by salon user_id (used by public embed without auth context). */
export async function fetchBrandingByUserId(userId: string): Promise<WhiteLabelBranding> {
  try {
    const { data } = await supabase
      .from("settings")
      .select("whitelabel_branding")
      .eq("user_id", userId)
      .maybeSingle();
    const remote = (data as any)?.whitelabel_branding as Partial<WhiteLabelBranding> | null;
    if (remote && typeof remote === "object") return { ...defaultBranding, ...remote };
    return defaultBranding;
  } catch {
    return defaultBranding;
  }
}

/** Save branding to both DB (settings table) and localStorage. */
export async function saveBranding(branding: WhiteLabelBranding): Promise<void> {
  writeLocal(branding);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("whitelabel:updated", { detail: branding }));
  }
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;
    const userId = auth.user.id;
    const { data: existing } = await supabase
      .from("settings")
      .select("id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing?.id) {
      await (supabase.from("settings") as any)
        .update({ whitelabel_branding: branding })
        .eq("id", existing.id);
    } else {
      await (supabase.from("settings") as any).insert({
        user_id: userId,
        whitelabel_branding: branding,
      });
    }
  } catch {
    /* swallow — local copy already persisted */
  }
}

function hexToHslString(hex: string): string {
  const cleaned = hex.replace("#", "");
  if (cleaned.length !== 6) return hex;
  const r = parseInt(cleaned.slice(0, 2), 16) / 255;
  const g = parseInt(cleaned.slice(2, 4), 16) / 255;
  const b = parseInt(cleaned.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / d + 2) * 60; break;
      case b: h = ((r - g) / d + 4) * 60; break;
    }
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function applyBrandingToDocument(branding: WhiteLabelBranding) {
  const root = document.documentElement;
  if (branding.primary_color.startsWith("#")) {
    root.style.setProperty("--primary", hexToHslString(branding.primary_color));
  }
  if (branding.secondary_color.startsWith("#")) {
    root.style.setProperty("--accent", hexToHslString(branding.secondary_color));
  }
  root.style.setProperty("--radius", `${branding.button_radius}px`);
  if (branding.font_preset === "serif") {
    root.style.setProperty("font-family", "Georgia, 'Times New Roman', serif");
  } else if (branding.font_preset === "system") {
    root.style.setProperty("font-family", "system-ui, -apple-system, sans-serif");
  }
}
