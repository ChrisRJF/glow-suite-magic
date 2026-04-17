// White-label branding storage + helpers for the embedded booking widget.
// Stored in localStorage so salons can preview/edit without DB migration.
// Future: sync to settings table.

export interface WhiteLabelBranding {
  salon_name: string;
  logo_url: string;
  primary_color: string; // HSL e.g. "262 83% 58%" or hex "#7B61FF"
  secondary_color: string;
  button_radius: number; // px
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

export function getBranding(): WhiteLabelBranding {
  if (typeof window === "undefined") return defaultBranding;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultBranding;
    return { ...defaultBranding, ...JSON.parse(raw) };
  } catch {
    return defaultBranding;
  }
}

export function saveBranding(branding: WhiteLabelBranding) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(branding));
  window.dispatchEvent(new CustomEvent("whitelabel:updated", { detail: branding }));
}

// Convert hex to HSL string for CSS variables
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
