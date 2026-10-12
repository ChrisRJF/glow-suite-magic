// INACTIVE (not imported by any entrypoint). Kassa betaalroute + verwerking na providerbewijs.
// Hergebruikt: create-viva-terminal-payment (betaling bij Viva), record_provider_payment (grootboek),
// kassa_* RPC's uit docs/proposed-migrations/2026-10-12_kassa_orders.sql.

export type BeginResult =
  | { ok: true; resumed: boolean; idempotency_key: string; payment_id: string | null; total_cents: number; is_demo: boolean; tenant_id: string; customer_id: string | null }
  | { ok: false; reason: string };

export interface KassaDeps {
  /** Verified actor from the JWT (never from the body). null = not signed in. */
  actor(): Promise<string | null>;
  begin(actor: string, orderId: string): Promise<BeginResult>;
  /** Existing terminal function, called server-side; amount/mode/tenant come only from `begin`. */
  startTerminal(input: { tenantId: string; terminalId: string; amountCents: number; isDemo: boolean; customerId: string | null; idempotencyKey: string; orderId: string }):
    Promise<{ ok: true; paymentId: string } | { ok: false; unclear: boolean; message: string }>;
  attach(orderId: string, key: string, paymentId: string): Promise<boolean>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NL: Record<string, string> = {
  no_access: "Je hebt geen kassarechten in deze salon.",
  not_found: "Deze bestelling bestaat niet in jouw salon.",
  live_not_allowed: "Live betalen is voor deze salon nog niet geactiveerd. Gebruik demo afrekenen.",
  settled: "Deze bestelling is al betaald.",
  cancelled: "Deze bestelling is geannuleerd.",
};

export type RouteResult = { status: number; body: Record<string, unknown> };

/** Body: { order_id, terminal_id }. Any amount, is_demo, tenant or customer in the body is ignored. */
export async function startKassaPayment(body: unknown, deps: KassaDeps): Promise<RouteResult> {
  const actor = await deps.actor();
  if (!actor) return { status: 401, body: { error: "unauthorized", message: "Log opnieuw in." } };
  const b = (body ?? {}) as Record<string, unknown>;
  const orderId = String(b.order_id ?? ""), terminalId = String(b.terminal_id ?? "");
  if (!UUID.test(orderId) || !UUID.test(terminalId)) return { status: 400, body: { error: "invalid", message: "Ongeldige aanvraag." } };
  const r = await deps.begin(actor, orderId);
  if (r.ok === false) return { status: r.reason === "no_access" ? 403 : 409, body: { error: r.reason, message: NL[r.reason] ?? "Afrekenen is nu niet mogelijk." } };
  // Resumed attempt that already has a Viva payment: never start a second one, show its status.
  if (r.payment_id) return { status: 200, body: { payment_id: r.payment_id, resumed: true, is_demo: r.is_demo } };
  const t = await deps.startTerminal({ tenantId: r.tenant_id, terminalId, amountCents: r.total_cents, isDemo: r.is_demo,
    customerId: r.customer_id, idempotencyKey: r.idempotency_key, orderId });
  if (t.ok === false) {
    // Unclear provider outcome: attempt stays open with the same key; retry reuses it (server idempotency).
    return { status: t.unclear ? 202 : 502, body: { error: t.unclear ? "unclear" : "provider_error", message: t.message, retry_same_key: true } };
  }
  if (!(await deps.attach(orderId, r.idempotency_key, t.paymentId))) {
    return { status: 409, body: { error: "attach_failed", message: "Betaling kon niet veilig aan de bestelling worden gekoppeld. Controleer de status." } };
  }
  return { status: 200, body: { payment_id: t.paymentId, resumed: false, is_demo: r.is_demo } };
}

/** Call from status-poll and webhook AFTER record_provider_payment / a provider-final failure. */
export async function afterProviderEvent(
  paymentId: string, final: "paid" | "failed" | "cancelled" | "expired" | null,
  rpc: (fn: "kassa_settle_order" | "kassa_attempt_failed", args: { _payment_id: string }) => Promise<string | null>,
): Promise<string> {
  if (final === "paid") return (await rpc("kassa_settle_order", { _payment_id: paymentId })) ?? "error";
  if (final) return (await rpc("kassa_attempt_failed", { _payment_id: paymentId })) ?? "error";
  return "noop";
}
