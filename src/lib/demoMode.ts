/**
 * Shared demo/live mode helpers.
 *
 * Single source of truth for guarding side-effecting actions so demo mode
 * never sends real WhatsApp messages, never calls Mollie, and never mixes
 * with live customer/appointment data.
 *
 * Usage:
 *   const { demoMode } = useDemoMode();
 *   if (isDemoMode(demoMode)) {
 *     simulateDemoAction("WhatsApp send", { to });
 *     return;
 *   }
 *   // ... real call
 */

import { toast } from "sonner";

export function isDemoMode(demoMode: boolean | undefined | null): boolean {
  return Boolean(demoMode);
}

/**
 * Throws if not in live mode. Use to wrap real-money / real-message paths
 * defensively when a function is called from a context that shouldn't reach it.
 */
export function assertLiveMode(demoMode: boolean | undefined | null, actionName: string): void {
  if (isDemoMode(demoMode)) {
    throw new Error(`${actionName} is geblokkeerd in demo modus`);
  }
}

/**
 * Show a friendly toast indicating a demo simulation occurred.
 * Returns a synthetic result object callers can use as if it were the real one.
 */
export function simulateDemoAction(
  actionName: string,
  payload?: Record<string, unknown>,
): { simulated: true; actionName: string; payload: Record<string, unknown> } {
  toast.success("Demo uitgevoerd — er is niets echt verstuurd of ingepland.", {
    description: actionName,
  });
  if (payload) {
    // eslint-disable-next-line no-console
    console.info("[demo-simulate]", actionName, payload);
  }
  return { simulated: true, actionName, payload: payload ?? {} };
}

/**
 * Friendly button labels for demo vs live primary actions.
 */
export function actionLabel(demoMode: boolean, kind: "run" | "enable"): string {
  if (kind === "run") return demoMode ? "Demo uitvoeren" : "Nu uitvoeren";
  return demoMode ? "Demo opnieuw laden" : "Automatisch inschakelen";
}
