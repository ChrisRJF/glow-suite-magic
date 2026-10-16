// Pure routing decision for create-payment. Fail-closed: only an explicitly stored
// 'viva' or 'mollie' provider routes anywhere. Unknown/missing/unreadable settings deny,
// and nothing ever silently falls back to Mollie.
export type ProviderRoute =
  | { kind: "viva" }
  | { kind: "mollie" }
  | { kind: "deny"; reason: string };

export interface RouteInput {
  /** True when the tenant-scoped settings query failed. */
  settingsError: boolean;
  /** The single tenant-scoped settings row, or null when missing. */
  settings: { payment_provider?: unknown } | null;
  /** Optional request source; 'test_button' tests Mollie Connect specifically. */
  source?: string;
}

export function routePayment(input: RouteInput): ProviderRoute {
  if (input.settingsError) return { kind: "deny", reason: "provider_unresolved" };
  if (!input.settings) return { kind: "deny", reason: "provider_unresolved" };
  const provider = input.settings.payment_provider;
  if (provider !== "viva" && provider !== "mollie") return { kind: "deny", reason: "provider_unresolved" };
  if (input.source === "test_button" && provider !== "mollie") {
    return { kind: "deny", reason: "test_button_not_available" };
  }
  return provider === "viva" ? { kind: "viva" } : { kind: "mollie" };
}
