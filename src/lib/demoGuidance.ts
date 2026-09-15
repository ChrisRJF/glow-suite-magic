/**
 * Presentation-only guidance state for the Beautycare demo.
 * Session storage only. No database writes, no business logic.
 */

export const GUIDANCE_TOTAL = 4;
export const WELCOME_KEY = "glowsuite_welcome_beautycare";
const stepKey = (step: number) => `glowsuite_hint_step_${step}`;

const mounted = new Set<number>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeGuidance(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function isStepDismissed(step: number): boolean {
  try {
    return sessionStorage.getItem(stepKey(step)) === "1";
  } catch {
    return false;
  }
}

export function dismissStep(step: number) {
  try {
    sessionStorage.setItem(stepKey(step), "1");
  } catch {
    /* ignore */
  }
  emit();
}

export function registerStep(step: number) {
  mounted.add(step);
  emit();
  return () => {
    mounted.delete(step);
    emit();
  };
}

/** Lowest mounted step that is not dismissed, so only one hint shows at a time. */
export function activeStep(): number | null {
  const open = [...mounted].filter((s) => !isStepDismissed(s)).sort((a, b) => a - b);
  return open.length ? open[0] : null;
}

export function isWelcomeHidden(): boolean {
  try {
    return sessionStorage.getItem(WELCOME_KEY) === "1";
  } catch {
    return false;
  }
}

export function hideWelcome() {
  try {
    sessionStorage.setItem(WELCOME_KEY, "1");
  } catch {
    /* ignore */
  }
  emit();
}

/** Reset only the welcome block and the four hints. Nothing else. */
export function resetDemoGuidance() {
  try {
    sessionStorage.removeItem(WELCOME_KEY);
    for (let s = 1; s <= GUIDANCE_TOTAL; s++) sessionStorage.removeItem(stepKey(s));
    // legacy id-based keys from the earlier hints
    ["agenda-open-afspraak", "afspraak-volgende-actie", "dossier-overzicht", "traject-sessies"].forEach((id) =>
      sessionStorage.removeItem(`glowsuite_hint_${id}`),
    );
  } catch {
    /* ignore */
  }
  emit();
}

/** Closes the guided route: dismisses every remaining step, keeps all data untouched. */
export function finishGuidance() {
  for (let s = 1; s <= GUIDANCE_TOTAL; s++) dismissStep(s);
}
