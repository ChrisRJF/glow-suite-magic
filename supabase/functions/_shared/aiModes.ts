// Shared AI modes helper for edge functions.
// Reads settings.whitelabel_branding.ai_modes (same shape as src/lib/aiModes.ts).
// Stricter of global vs category wins.

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

const VALID: AIMode[] = ["off", "suggestions", "autopilot"];
const ORDER: AIMode[] = ["off", "suggestions", "autopilot"];

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

function safe(v: unknown, fb: AIMode): AIMode {
  return typeof v === "string" && (VALID as string[]).includes(v) ? (v as AIMode) : fb;
}

function normalize(raw: any): AIModes {
  if (!raw || typeof raw !== "object") return DEFAULT_AI_MODES;
  const cats = raw.categories || {};
  return {
    global: safe(raw.global, DEFAULT_AI_MODES.global),
    categories: {
      betalingen: safe(cats.betalingen, DEFAULT_AI_MODES.categories.betalingen),
      no_show: safe(cats.no_show, DEFAULT_AI_MODES.categories.no_show),
      memberships: safe(cats.memberships, DEFAULT_AI_MODES.categories.memberships),
      klant_retention: safe(cats.klant_retention, DEFAULT_AI_MODES.categories.klant_retention),
      lege_plekken: safe(cats.lege_plekken, DEFAULT_AI_MODES.categories.lege_plekken),
      campagnes: safe(cats.campagnes, DEFAULT_AI_MODES.categories.campagnes),
    },
  };
}

export function effectiveMode(modes: AIModes, category: AICategory): AIMode {
  const g = ORDER.indexOf(modes.global);
  const c = ORDER.indexOf(modes.categories[category]);
  return ORDER[Math.min(g, c)];
}

export function canAutoRun(modes: AIModes, category: AICategory): boolean {
  return effectiveMode(modes, category) === "autopilot";
}

export function canSuggest(modes: AIModes, category: AICategory): boolean {
  const m = effectiveMode(modes, category);
  return m === "suggestions" || m === "autopilot";
}

/**
 * Load AI modes for a user. Picks the matching live/demo settings row.
 * Falls back to DEFAULT_AI_MODES on any error.
 */
export async function loadAIModes(
  admin: any,
  user_id: string,
  is_demo = false,
): Promise<AIModes> {
  try {
    let q = admin
      .from("settings")
      .select("whitelabel_branding, is_demo, demo_mode")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (is_demo) q = q.or("is_demo.eq.true,demo_mode.eq.true");
    else q = q.or("is_demo.eq.false,is_demo.is.null");
    const { data } = await q.maybeSingle();
    return normalize((data as any)?.whitelabel_branding?.ai_modes);
  } catch {
    return DEFAULT_AI_MODES;
  }
}

/** Map an automation rule trigger_type to an AI category. Returns null if not gated. */
export function triggerToCategory(trigger: string): AICategory | null {
  const t = (trigger || "").toLowerCase();
  if (/(payment_failed|betaling_mislukt|unpaid|invoice|incasso|refund)/.test(t)) return "betalingen";
  if (/(membership|renewal|credits|trial|cancel_winback)/.test(t)) return "memberships";
  if (/(no_show|noshow|deposit_reminder)/.test(t)) return "no_show";
  if (/(reminder|afspraak_geboekt|reminder_24h|reminder_2h)/.test(t)) return "no_show";
  if (/(rebook|inactive|review|na_afspraak|reactiv|winback|herboek)/.test(t)) return "klant_retention";
  if (/(campagne|campaign|broadcast|nieuwsbrief)/.test(t)) return "campagnes";
  if (/(empty_slot|lege_plek|auto_revenue|fill_today)/.test(t)) return "lege_plekken";
  return null;
}
