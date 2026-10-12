// Mirrors the database protection rule: Viva/Mollie and Kassa payments are confirmed only by the provider.
export function isProviderPayment(p: { provider?: string | null; metadata?: unknown }): boolean {
  const meta = p.metadata && typeof p.metadata === "object" && !Array.isArray(p.metadata) ? (p.metadata as Record<string, unknown>) : {};
  return ["viva", "mollie"].includes(String(p.provider ?? "")) || "kassa_order_id" in meta;
}
